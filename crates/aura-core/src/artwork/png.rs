//! Minimal PNG writer: 8-bit RGBA, no interlacing, one IDAT.
//!
//! Rolled by hand rather than adding an `image`/`png` dependency because the only producer is
//! [`super::exe_icon`] - a handful of small bitmaps that are already RGBA - and a new crate in
//! the tree costs more than sixty lines do.
//!
//! The zlib stream uses *stored* (uncompressed) deflate blocks. That makes an icon a few
//! hundred kilobytes instead of a few tens, which is nothing against the 25 MB cache limit in
//! [`super::cache`], and it keeps the encoder short enough to audit in one sitting. If icons
//! ever get big enough for that to matter, this is the place to add a real deflate - the output
//! is a normal PNG either way.

use crate::error::{CoreError, Result};

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// A stored deflate block carries a `u16` length, so that is the block size.
const MAX_STORED_BLOCK: usize = 0xFFFF;

/// Refuse absurd dimensions before allocating for them.
const MAX_DIMENSION: u32 = 8192;

/// Encode top-down, non-premultiplied RGBA8 as a PNG. `rgba` must be exactly
/// `width * height * 4` bytes.
pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    if width == 0 || height == 0 {
        return Err(CoreError::Invalid("a PNG needs a non-zero width and height".into()));
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(CoreError::Invalid(format!(
            "{width}x{height} is larger than the {MAX_DIMENSION}px limit"
        )));
    }
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(CoreError::Invalid(format!(
            "expected {expected} bytes of RGBA for {width}x{height}, got {}",
            rgba.len()
        )));
    }

    // PNG rows are prefixed with a filter byte. 0 = None: the pixels are stored verbatim,
    // which is what an uncompressed stream wants anyway.
    let stride = width as usize * 4;
    let mut raw = Vec::with_capacity(expected + height as usize);
    for row in rgba.chunks_exact(stride) {
        raw.push(0);
        raw.extend_from_slice(row);
    }

    let mut out = Vec::with_capacity(raw.len() + 128);
    out.extend_from_slice(&SIGNATURE);

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    // bit depth 8, colour type 6 (truecolour + alpha), deflate, adaptive filtering, no interlace.
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &zlib_stored(&raw));
    chunk(&mut out, b"IEND", &[]);
    Ok(out)
}

/// `length | type | data | crc`, with the CRC covering type and data but not the length.
fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = out.len();
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let crc = crc32(&out[start..]);
    out.extend_from_slice(&crc.to_be_bytes());
}

/// A zlib stream (RFC 1950) whose deflate payload is one or more stored blocks (RFC 1951 §3.2.4).
fn zlib_stored(raw: &[u8]) -> Vec<u8> {
    // CMF 0x78 = deflate with a 32K window; FLG 0x01 has no preset dictionary and makes
    // (CMF << 8 | FLG) a multiple of 31, as the format requires.
    let mut out = vec![0x78, 0x01];

    if raw.is_empty() {
        // One final, empty stored block.
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
    } else {
        let blocks = raw.len().div_ceil(MAX_STORED_BLOCK);
        for (i, block) in raw.chunks(MAX_STORED_BLOCK).enumerate() {
            // BFINAL on the last block, BTYPE 00 (stored) on all of them.
            out.push(if i + 1 == blocks { 1 } else { 0 });
            let len = block.len() as u16;
            out.extend_from_slice(&len.to_le_bytes());
            out.extend_from_slice(&(!len).to_le_bytes());
            out.extend_from_slice(block);
        }
    }

    out.extend_from_slice(&adler32(raw).to_be_bytes());
    out
}

/// CRC-32 as PNG specifies it. Bitwise rather than table-driven: a few hundred kilobytes of
/// icon is not worth a 1 KB static table.
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xffff_ffff;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// Adler-32, the zlib stream checksum.
fn adler32(bytes: &[u8]) -> u32 {
    const MOD: u32 = 65521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in bytes {
        a = (a + byte as u32) % MOD;
        b = (b + a) % MOD;
    }
    (b << 16) | a
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Walk the chunk list, checking every CRC. Returns (type, data) per chunk.
    fn parse_chunks(png: &[u8]) -> Vec<(String, Vec<u8>)> {
        assert_eq!(&png[..8], &SIGNATURE, "PNG signature");
        let mut out = Vec::new();
        let mut i = 8;
        while i < png.len() {
            let len = u32::from_be_bytes(png[i..i + 4].try_into().unwrap()) as usize;
            let kind = String::from_utf8(png[i + 4..i + 8].to_vec()).unwrap();
            let data = png[i + 8..i + 8 + len].to_vec();
            let crc = u32::from_be_bytes(png[i + 8 + len..i + 12 + len].try_into().unwrap());
            assert_eq!(crc, crc32(&png[i + 4..i + 8 + len]), "CRC of the {kind} chunk");
            out.push((kind, data));
            i += 12 + len;
        }
        out
    }

    #[test]
    fn known_checksums() {
        // "IEND" is the standard worked example: its CRC is fixed by the format.
        assert_eq!(crc32(b"IEND"), 0xae42_6082);
        assert_eq!(crc32(b""), 0);
        // zlib's own documented example.
        assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);
        assert_eq!(adler32(b""), 1);
    }

    #[test]
    fn writes_a_well_formed_png() {
        let rgba: Vec<u8> = (0..2 * 3 * 4).map(|i| i as u8).collect();
        let png = encode_rgba(2, 3, &rgba).unwrap();

        let chunks = parse_chunks(&png);
        let kinds: Vec<&str> = chunks.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(kinds, vec!["IHDR", "IDAT", "IEND"], "exactly the chunks we write, in order");

        let ihdr = &chunks[0].1;
        assert_eq!(u32::from_be_bytes(ihdr[0..4].try_into().unwrap()), 2);
        assert_eq!(u32::from_be_bytes(ihdr[4..8].try_into().unwrap()), 3);
        assert_eq!(&ihdr[8..], &[8, 6, 0, 0, 0], "8-bit RGBA, deflate, no interlace");
        assert!(chunks[2].1.is_empty(), "IEND carries no data");
    }

    #[test]
    fn the_idat_is_a_readable_zlib_stream() {
        // 1x2 so there are two rows, each with its filter byte.
        let png = encode_rgba(1, 2, &[1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
        let idat = &parse_chunks(&png)[1].1;

        assert_eq!(&idat[..2], &[0x78, 0x01], "zlib header");
        assert_eq!(
            (u16::from_be_bytes([idat[0], idat[1]]) as u32) % 31,
            0,
            "the header check bits must make it divisible by 31"
        );

        // One stored block: BFINAL=1, then LEN and its complement, then the raw bytes.
        assert_eq!(idat[2], 0x01, "a single final stored block");
        let len = u16::from_le_bytes([idat[3], idat[4]]);
        let nlen = u16::from_le_bytes([idat[5], idat[6]]);
        assert_eq!(len, 10, "2 rows x (1 filter byte + 4 colour bytes)");
        assert_eq!(nlen, !len, "NLEN is LEN's one's complement");

        let expected_raw = [0u8, 1, 2, 3, 4, 0, 5, 6, 7, 8];
        assert_eq!(&idat[7..7 + 10], &expected_raw, "rows are filter byte + verbatim pixels");
        assert_eq!(
            &idat[17..],
            &adler32(&expected_raw).to_be_bytes(),
            "the stream ends with the adler32 of the uncompressed data"
        );
    }

    #[test]
    fn splits_data_over_several_stored_blocks() {
        // 4 bytes/px + 1 filter byte per row; 40 rows of 512px is 82 KB, over one block.
        let (w, h) = (512u32, 40u32);
        let png = encode_rgba(w, h, &vec![7u8; (w * h * 4) as usize]).unwrap();
        let idat = &parse_chunks(&png)[1].1;

        let raw_len = (w as usize * 4 + 1) * h as usize;
        assert!(raw_len > MAX_STORED_BLOCK, "the fixture must actually need two blocks");

        // First block header: not final.
        assert_eq!(idat[2], 0x00);
        assert_eq!(u16::from_le_bytes([idat[3], idat[4]]), MAX_STORED_BLOCK as u16);

        // Second block header sits right after the first block's payload, and is the last.
        let second = 2 + 5 + MAX_STORED_BLOCK;
        assert_eq!(idat[second], 0x01);
        assert_eq!(
            u16::from_le_bytes([idat[second + 1], idat[second + 2]]) as usize,
            raw_len - MAX_STORED_BLOCK
        );
    }

    #[test]
    fn rejects_mismatched_and_absurd_input() {
        assert!(matches!(encode_rgba(0, 1, &[]), Err(CoreError::Invalid(_))));
        assert!(matches!(encode_rgba(1, 0, &[]), Err(CoreError::Invalid(_))));
        assert!(matches!(encode_rgba(1, 1, &[0, 0, 0]), Err(CoreError::Invalid(_))));
        assert!(matches!(encode_rgba(1, 1, &[0; 8]), Err(CoreError::Invalid(_))));
        assert!(matches!(encode_rgba(99_999, 1, &[]), Err(CoreError::Invalid(_))));
    }
}
