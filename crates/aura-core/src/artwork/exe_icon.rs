//! The icon inside a program's own executable - the one Explorer already shows for it.
//!
//! Steam titles get real cover art from the CDN and SteamGridDB. A hand-added program has no
//! store id to look up, and SteamGridDB is a *game* art database: it has essentially nothing for
//! Discord, Notepad++ or a build tool. The executable itself does, so that is where a manual
//! entry's artwork comes from. Offline, instant, and always the right picture.
//!
//! Layer notes:
//! - The Win32 side is declared as raw FFI against `shell32`/`user32`/`gdi32`/`ole32` for the
//!   same reason `process::tree` does it: these entry points have a stable ABI, while the handle
//!   newtypes in the `windows` crate have changed shape across releases.
//! - Everything above that FFI ([`IconBitmap`], [`center_on_canvas`], [`is_shortcut`]) is plain
//!   Rust and is tested on every platform; only [`extract`] needs Windows.

use std::path::{Path, PathBuf};

use crate::error::Result;

/// The size we ask Windows for. 256 is the largest an icon resource carries, and it is what
/// Explorer's own extra-large view uses.
pub const ICON_SIZE: u32 = 256;

/// Grid assets are 2:3, like Steam's own library covers and the `tile.aspect` theme token, so a
/// square icon has to be letterboxed onto that shape - `object-fit: cover` would otherwise crop
/// a third of it away. Deliberately modest: the icon inside is 256px, so a bigger canvas would
/// only add transparent pixels, and [`super::png`] stores them uncompressed.
pub const GRID_WIDTH: u32 = 300;
pub const GRID_HEIGHT: u32 = 450;

// Guaranteed at compile time rather than by a test, since both are constants: a careless edit
// to either cannot get as far as a test run.
const _: () = assert!(
    GRID_WIDTH * 3 == GRID_HEIGHT * 2,
    "the grid canvas must stay 2:3"
);
const _: () = assert!(
    GRID_WIDTH >= ICON_SIZE,
    "an icon must fit the canvas without cropping"
);

/// An extracted icon: top-down, non-premultiplied RGBA8, `width * height * 4` bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconBitmap {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Centre `icon` on a transparent `width` x `height` canvas.
///
/// An icon larger than the canvas is cropped evenly on all sides rather than scaled: there is no
/// resampler here, and in practice the canvas is always the larger of the two.
pub fn center_on_canvas(icon: &IconBitmap, width: u32, height: u32) -> Vec<u8> {
    let mut canvas = vec![0u8; width as usize * height as usize * 4];
    let left = (width as i64 - icon.width as i64) / 2;
    let top = (height as i64 - icon.height as i64) / 2;

    for row in 0..icon.height as i64 {
        let y = top + row;
        if y < 0 || y >= height as i64 {
            continue;
        }
        for col in 0..icon.width as i64 {
            let x = left + col;
            if x < 0 || x >= width as i64 {
                continue;
            }
            let src = ((row * icon.width as i64 + col) * 4) as usize;
            let dst = ((y * width as i64 + x) * 4) as usize;
            canvas[dst..dst + 4].copy_from_slice(&icon.rgba[src..src + 4]);
        }
    }
    canvas
}

/// True for paths Windows resolves through the shell link API rather than reading directly.
pub fn is_shortcut(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"))
}

/// The file an icon should be read from: a `.lnk` points at its target, anything else is itself.
///
/// A shortcut whose target cannot be resolved (a virtual target, a missing drive, COM
/// unavailable) falls back to the shortcut, which Windows can still produce a system icon for.
#[cfg(windows)]
pub fn icon_source(path: &Path) -> PathBuf {
    if is_shortcut(path) {
        if let Some(target) = win::resolve_shortcut(path) {
            if target.is_file() {
                return target;
            }
        }
    }
    path.to_path_buf()
}

/// Off Windows there are no shortcuts to follow.
#[cfg(not(windows))]
pub fn icon_source(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Read the largest icon Windows has for `path`, resolving a `.lnk` to its target first.
#[cfg(windows)]
pub fn extract(path: &Path) -> Result<IconBitmap> {
    win::extract(&icon_source(path), ICON_SIZE)
}

#[cfg(not(windows))]
pub fn extract(_path: &Path) -> Result<IconBitmap> {
    Err(crate::error::CoreError::Unsupported(
        "executable icon extraction needs Windows".into(),
    ))
}

/// The icon at its native size, and the same icon letterboxed onto a grid-shaped canvas, both
/// encoded as PNG. Returns `(icon_png, grid_png)`.
pub fn extract_pngs(path: &Path) -> Result<(Vec<u8>, Vec<u8>)> {
    let icon = extract(path)?;
    let icon_png = super::png::encode_rgba(icon.width, icon.height, &icon.rgba)?;
    let grid = center_on_canvas(&icon, GRID_WIDTH, GRID_HEIGHT);
    let grid_png = super::png::encode_rgba(GRID_WIDTH, GRID_HEIGHT, &grid)?;
    Ok((icon_png, grid_png))
}

// -------------------------------------------------------------------------------------------
// Win32
// -------------------------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};

    use super::IconBitmap;
    use crate::error::{CoreError, Result};

    type Handle = *mut c_void;

    const S_OK: i32 = 0;
    const S_FALSE: i32 = 1;
    /// COM is already initialised on this thread in the other apartment model. Usable all the
    /// same, but we must not balance it with a `CoUninitialize`.
    const RPC_E_CHANGED_MODE: i32 = 0x8001_0106_u32 as i32;
    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const CLSCTX_INPROC_SERVER: u32 = 0x1;
    const STGM_READ: u32 = 0x0;

    const BI_RGB: u32 = 0;
    const DIB_RGB_COLORS: u32 = 0;
    const SHGFI_ICON: u32 = 0x0000_0100;
    /// Guard against a bitmap so large the RGBA copy would be silly. Icons are <= 256px.
    const MAX_ICON_DIMENSION: i32 = 1024;

    // ---- structures -------------------------------------------------------------------------
    //
    // Field order and types mirror the Win32 headers exactly, so `repr(C)` reproduces the C
    // layout - padding included - on every target. Most fields are never read from Rust: their
    // job is to occupy the right bytes, which is why `dead_code` is silenced on each of them
    // rather than the module.

    #[repr(C)]
    #[allow(dead_code)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    /// `CLSID_ShellLink` - {00021401-0000-0000-C000-000000000046}
    const CLSID_SHELL_LINK: Guid = Guid {
        data1: 0x0002_1401,
        data2: 0,
        data3: 0,
        data4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46],
    };
    /// `IID_IShellLinkW` - {000214F9-0000-0000-C000-000000000046}
    const IID_ISHELL_LINK_W: Guid = Guid {
        data1: 0x0002_14F9,
        data2: 0,
        data3: 0,
        data4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46],
    };
    /// `IID_IPersistFile` - {0000010B-0000-0000-C000-000000000046}
    const IID_IPERSIST_FILE: Guid = Guid {
        data1: 0x0000_010B,
        data2: 0,
        data3: 0,
        data4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46],
    };

    #[repr(C)]
    #[allow(dead_code)]
    struct IconInfo {
        f_icon: i32,
        x_hotspot: u32,
        y_hotspot: u32,
        hbm_mask: Handle,
        hbm_color: Handle,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct Bitmap {
        bm_type: i32,
        bm_width: i32,
        bm_height: i32,
        bm_width_bytes: i32,
        bm_planes: u16,
        bm_bits_pixel: u16,
        bm_bits: *mut c_void,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct BitmapInfoHeader {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    /// `BITMAPINFO` with room for a full palette. A 32bpp `BI_RGB` request does not use one, but
    /// giving `GetDIBits` the space costs nothing and cannot then be overrun.
    #[repr(C)]
    #[allow(dead_code)]
    struct BitmapInfo {
        header: BitmapInfoHeader,
        colors: [u32; 256],
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct ShFileInfoW {
        h_icon: Handle,
        i_icon: i32,
        dw_attributes: u32,
        sz_display_name: [u16; 260],
        sz_type_name: [u16; 80],
    }

    // ---- COM vtables ------------------------------------------------------------------------
    //
    // Only the slots we call are declared. Truncating a vtable is safe as long as nothing past
    // the last declared method is ever invoked - so do not add a call without also adding every
    // slot above it, in header order.

    #[repr(C)]
    #[allow(dead_code)]
    struct IUnknownVtbl {
        query_interface: unsafe extern "system" fn(Handle, *const Guid, *mut Handle) -> i32,
        add_ref: unsafe extern "system" fn(Handle) -> u32,
        release: unsafe extern "system" fn(Handle) -> u32,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct IPersistFileVtbl {
        base: IUnknownVtbl,
        get_class_id: unsafe extern "system" fn(Handle, *mut Guid) -> i32,
        is_dirty: unsafe extern "system" fn(Handle) -> i32,
        load: unsafe extern "system" fn(Handle, *const u16, u32) -> i32,
        // Save, SaveCompleted and GetCurFile follow and are not used.
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct IShellLinkWVtbl {
        base: IUnknownVtbl,
        get_path: unsafe extern "system" fn(Handle, *mut u16, i32, *mut c_void, u32) -> i32,
        // The other seventeen IShellLinkW methods follow and are not used.
    }

    // ---- imports ----------------------------------------------------------------------------

    #[link(name = "user32")]
    extern "system" {
        fn GetIconInfo(icon: Handle, info: *mut IconInfo) -> i32;
        fn DestroyIcon(icon: Handle) -> i32;
        fn GetDC(window: Handle) -> Handle;
        fn ReleaseDC(window: Handle, dc: Handle) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn GetObjectW(object: Handle, size: i32, out: *mut c_void) -> i32;
        fn DeleteObject(object: Handle) -> i32;
        fn GetDIBits(
            dc: Handle,
            bitmap: Handle,
            start_line: u32,
            lines: u32,
            bits: *mut c_void,
            info: *mut BitmapInfo,
            usage: u32,
        ) -> i32;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHDefExtractIconW(
            file: *const u16,
            index: i32,
            flags: u32,
            large: *mut Handle,
            small: *mut Handle,
            icon_size: u32,
        ) -> i32;
        fn ExtractIconExW(
            file: *const u16,
            index: i32,
            large: *mut Handle,
            small: *mut Handle,
            icons: u32,
        ) -> u32;
        fn SHGetFileInfoW(
            path: *const u16,
            attributes: u32,
            info: *mut ShFileInfoW,
            size: u32,
            flags: u32,
        ) -> usize;
    }

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, co_init: u32) -> i32;
        fn CoUninitialize();
        fn CoCreateInstance(
            clsid: *const Guid,
            outer: Handle,
            context: u32,
            iid: *const Guid,
            out: *mut Handle,
        ) -> i32;
    }

    // ---- helpers ----------------------------------------------------------------------------

    /// A path as a NUL-terminated UTF-16 string, ready for a `*W` entry point.
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// The vtable pointer a COM object starts with.
    ///
    /// # Safety
    /// `object` must be a live COM interface pointer whose vtable begins with `T`'s slots.
    unsafe fn vtable<T>(object: Handle) -> *const T {
        *(object as *const *const T)
    }

    // ---- shortcut resolution ----------------------------------------------------------------

    /// The file a `.lnk` points at, via `IShellLinkW`. `None` for anything that is not a plain
    /// path (a shortcut to a virtual folder, a broken link, COM unavailable).
    pub fn resolve_shortcut(lnk: &Path) -> Option<PathBuf> {
        let path = wide(lnk);
        // SAFETY: COM is initialised and balanced around a single call on this thread, and the
        // helper below releases every interface pointer it creates on every path out.
        unsafe {
            let hr = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);
            if hr < 0 && hr != RPC_E_CHANGED_MODE {
                return None;
            }
            let target = shortcut_target(&path);
            // Only unwind our own initialisation: RPC_E_CHANGED_MODE means someone else owns it.
            if hr == S_OK || hr == S_FALSE {
                CoUninitialize();
            }
            target
        }
    }

    /// # Safety
    /// COM must be initialised on the calling thread, and `path` NUL-terminated.
    unsafe fn shortcut_target(path: &[u16]) -> Option<PathBuf> {
        let mut link: Handle = std::ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_SHELL_LINK,
            std::ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &IID_ISHELL_LINK_W,
            &mut link,
        );
        if hr < 0 || link.is_null() {
            return None;
        }
        let link_vt = vtable::<IShellLinkWVtbl>(link);
        let release = (*link_vt).base.release;

        // A .lnk is read through the object's IPersistFile face; that is how the shell does it.
        let mut persist: Handle = std::ptr::null_mut();
        let hr = ((*link_vt).base.query_interface)(link, &IID_IPERSIST_FILE, &mut persist);
        if hr < 0 || persist.is_null() {
            release(link);
            return None;
        }
        let persist_vt = vtable::<IPersistFileVtbl>(persist);
        let loaded = ((*persist_vt).load)(persist, path.as_ptr(), STGM_READ);
        ((*persist_vt).base.release)(persist);
        if loaded < 0 {
            release(link);
            return None;
        }

        // `Resolve` is deliberately not called: it can block on a network share or raise UI, and
        // a stale shortcut is worth a missing icon, not a hang.
        let mut buffer = [0u16; 1024];
        let hr = ((*link_vt).get_path)(
            link,
            buffer.as_mut_ptr(),
            buffer.len() as i32,
            std::ptr::null_mut(),
            0,
        );
        release(link);
        if hr < 0 {
            return None;
        }

        // GetPath returns S_FALSE and an empty buffer when the target has no file path at all.
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        if end == 0 {
            return None;
        }
        Some(PathBuf::from(OsString::from_wide(&buffer[..end])))
    }

    // ---- icon extraction --------------------------------------------------------------------

    /// Ask Windows for the best icon it has for `path` and hand it back as RGBA.
    pub fn extract(path: &Path, size: u32) -> Result<IconBitmap> {
        let file = wide(path);
        // SAFETY: every handle obtained below is destroyed on all paths out, and the only
        // buffers handed to Win32 are sized from `size_of` or the bitmap's own dimensions.
        unsafe {
            let icon = best_icon(&file, size)
                .ok_or_else(|| CoreError::NotFound(format!("no icon in `{}`", path.display())))?;
            let bitmap = icon_to_rgba(icon);
            DestroyIcon(icon);
            bitmap
        }
    }

    /// Three attempts, best first. Each hands back an owned `HICON`.
    ///
    /// # Safety
    /// `file` must be a NUL-terminated wide path.
    unsafe fn best_icon(file: &[u16], size: u32) -> Option<Handle> {
        let mut large: Handle = std::ptr::null_mut();
        let mut small: Handle = std::ptr::null_mut();

        // 1. The exact size we want, scaled by the shell from the best resource in the file.
        //    The size argument packs the large icon in the low word and the small in the high.
        let packed = (size & 0xFFFF) | (32u32 << 16);
        SHDefExtractIconW(file.as_ptr(), 0, 0, &mut large, &mut small, packed);
        if !small.is_null() {
            DestroyIcon(small);
            small = std::ptr::null_mut();
        }
        if !large.is_null() {
            return Some(large);
        }

        // 2. The plain extractor, at the system large-icon size.
        ExtractIconExW(file.as_ptr(), 0, &mut large, &mut small, 1);
        if !small.is_null() {
            DestroyIcon(small);
        }
        if !large.is_null() {
            return Some(large);
        }

        // 3. Whatever Explorer itself would show: a by-file-type document icon, or the resolved
        //    target's icon for a shortcut we could not follow ourselves. SHGFI_LARGEICON is 0 -
        //    the large icon is the default - so SHGFI_ICON is the whole flag set.
        let mut info: ShFileInfoW = std::mem::zeroed();
        SHGetFileInfoW(
            file.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<ShFileInfoW>() as u32,
            SHGFI_ICON,
        );
        (!info.h_icon.is_null()).then_some(info.h_icon)
    }

    /// # Safety
    /// `icon` must be a live `HICON`. Its bitmaps become ours to delete, per `GetIconInfo`.
    unsafe fn icon_to_rgba(icon: Handle) -> Result<IconBitmap> {
        let mut info: IconInfo = std::mem::zeroed();
        if GetIconInfo(icon, &mut info) == 0 {
            return Err(CoreError::Other("GetIconInfo failed".into()));
        }
        let result = bitmaps_to_rgba(info.hbm_color, info.hbm_mask);
        if !info.hbm_color.is_null() {
            DeleteObject(info.hbm_color);
        }
        if !info.hbm_mask.is_null() {
            DeleteObject(info.hbm_mask);
        }
        result
    }

    /// # Safety
    /// Both handles must be `HBITMAP`s belonging to one icon, or null.
    unsafe fn bitmaps_to_rgba(color: Handle, mask: Handle) -> Result<IconBitmap> {
        // A 1-bit icon has no colour bitmap at all - its mask holds stacked AND and XOR halves.
        // Those are museum pieces; refusing beats mis-rendering one.
        if color.is_null() {
            return Err(CoreError::Unsupported(
                "monochrome icons are not supported".into(),
            ));
        }

        let mut bm: Bitmap = std::mem::zeroed();
        let size = std::mem::size_of::<Bitmap>() as i32;
        if GetObjectW(color, size, (&mut bm as *mut Bitmap).cast()) == 0 {
            return Err(CoreError::Other(
                "GetObject on the icon bitmap failed".into(),
            ));
        }
        if bm.bm_width <= 0
            || bm.bm_height <= 0
            || bm.bm_width > MAX_ICON_DIMENSION
            || bm.bm_height > MAX_ICON_DIMENSION
        {
            return Err(CoreError::Invalid(format!(
                "icon bitmap is {}x{}, which is not a usable size",
                bm.bm_width, bm.bm_height
            )));
        }
        let (width, height) = (bm.bm_width as u32, bm.bm_height as u32);

        let dc = GetDC(std::ptr::null_mut());
        if dc.is_null() {
            return Err(CoreError::Other(
                "no device context for the icon read".into(),
            ));
        }
        let color_bits = read_bgra(dc, color, width, height);
        // The mask is only read when the colour bitmap turns out to have no alpha at all.
        // `as_chunks::<4>()` rather than `chunks_exact(4)`: same grouping, but the pixel is a
        // fixed-size array so indexing it needs no bounds check.
        let needs_mask = color_bits
            .as_ref()
            .is_some_and(|bits| bits.as_chunks::<4>().0.iter().all(|px| px[3] == 0));
        let mask_bits = if needs_mask && !mask.is_null() {
            read_bgra(dc, mask, width, height)
        } else {
            None
        };
        ReleaseDC(std::ptr::null_mut(), dc);

        let mut pixels =
            color_bits.ok_or_else(|| CoreError::Other("GetDIBits on the icon failed".into()))?;

        if needs_mask {
            // A pre-Vista icon carries no alpha channel: transparency lives in the 1-bit mask,
            // where a set bit means "leave the background alone". Read back as 32bpp, a set bit
            // arrives white and a clear bit black.
            match mask_bits {
                Some(mask_bits) => {
                    let mask_px = mask_bits.as_chunks::<4>().0;
                    for (px, m) in pixels.as_chunks_mut::<4>().0.iter_mut().zip(mask_px) {
                        px[3] = if m[0] == 0 { 0xFF } else { 0x00 };
                    }
                }
                // No mask either: a fully transparent image is never what was meant.
                None => {
                    for px in pixels.as_chunks_mut::<4>().0 {
                        px[3] = 0xFF;
                    }
                }
            }
        }

        // GetDIBits hands back BGRA; PNG wants RGBA.
        for px in pixels.as_chunks_mut::<4>().0 {
            px.swap(0, 2);
        }

        Ok(IconBitmap {
            width,
            height,
            rgba: pixels,
        })
    }

    /// Read a bitmap as top-down 32bpp BGRA.
    ///
    /// # Safety
    /// `dc` and `bitmap` must be live handles, and the dimensions the bitmap's own.
    unsafe fn read_bgra(dc: Handle, bitmap: Handle, width: u32, height: u32) -> Option<Vec<u8>> {
        let mut info: BitmapInfo = std::mem::zeroed();
        info.header.bi_size = std::mem::size_of::<BitmapInfoHeader>() as u32;
        info.header.bi_width = width as i32;
        // A negative height asks for top-down rows, which is the order PNG writes them in.
        info.header.bi_height = -(height as i32);
        info.header.bi_planes = 1;
        info.header.bi_bit_count = 32;
        info.header.bi_compression = BI_RGB;

        let mut buffer = vec![0u8; width as usize * height as usize * 4];
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            height,
            buffer.as_mut_ptr().cast(),
            &mut info,
            DIB_RGB_COLORS,
        );
        (lines > 0).then_some(buffer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, colour: [u8; 4]) -> IconBitmap {
        IconBitmap {
            width,
            height,
            rgba: colour
                .iter()
                .copied()
                .cycle()
                .take((width * height * 4) as usize)
                .collect(),
        }
    }

    #[test]
    fn shortcuts_are_recognised_case_insensitively() {
        assert!(is_shortcut(Path::new(r"C:\Users\x\Desktop\Discord.lnk")));
        assert!(is_shortcut(Path::new(r"C:\x\THING.LNK")));
        assert!(!is_shortcut(Path::new(r"C:\x\thing.exe")));
        assert!(
            !is_shortcut(Path::new(r"C:\x\lnk")),
            "a bare name is not an extension"
        );
        assert!(!is_shortcut(Path::new("")));
    }

    #[test]
    fn a_plain_executable_is_its_own_icon_source() {
        let exe = Path::new(r"C:\Programs\Thing\thing.exe");
        assert_eq!(icon_source(exe), exe.to_path_buf());
    }

    #[test]
    fn an_unresolvable_shortcut_falls_back_to_itself() {
        // Nothing can resolve this, on Windows or anywhere else.
        let lnk = Path::new(r"Z:\definitely\missing.lnk");
        assert_eq!(icon_source(lnk), lnk.to_path_buf());
    }

    #[test]
    fn centring_pads_a_square_icon_onto_the_grid_shape() {
        let icon = solid(2, 2, [10, 20, 30, 255]);
        let canvas = center_on_canvas(&icon, 4, 6);
        assert_eq!(canvas.len(), 4 * 6 * 4);

        let pixel = |x: usize, y: usize| -> [u8; 4] {
            let i = (y * 4 + x) * 4;
            canvas[i..i + 4].try_into().unwrap()
        };

        // 2x2 centred on 4x6 lands at x 1..3, y 2..4.
        assert_eq!(pixel(1, 2), [10, 20, 30, 255]);
        assert_eq!(pixel(2, 3), [10, 20, 30, 255]);
        // Everything else stays fully transparent.
        assert_eq!(pixel(0, 0), [0, 0, 0, 0]);
        assert_eq!(pixel(3, 5), [0, 0, 0, 0]);
        assert_eq!(pixel(1, 1), [0, 0, 0, 0]);
    }

    #[test]
    fn centring_crops_an_icon_larger_than_the_canvas() {
        let icon = solid(6, 6, [1, 2, 3, 4]);
        let canvas = center_on_canvas(&icon, 2, 2);
        assert_eq!(canvas.len(), 2 * 2 * 4);
        assert!(
            canvas
                .as_chunks::<4>()
                .0
                .iter()
                .all(|px| *px == [1, 2, 3, 4]),
            "no gaps and no panic"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn extraction_reports_itself_unsupported_off_windows() {
        assert!(matches!(
            extract(Path::new("/bin/sh")),
            Err(crate::error::CoreError::Unsupported(_))
        ));
    }

    /// On Windows there is always at least one executable with an icon to read.
    #[cfg(windows)]
    #[test]
    fn extracts_a_real_icon_from_a_system_executable() {
        let candidates = [
            r"C:\Windows\explorer.exe",
            r"C:\Windows\System32\notepad.exe",
        ];
        let Some(exe) = candidates.iter().map(Path::new).find(|p| p.is_file()) else {
            eprintln!("skipping: no system executable found");
            return;
        };

        let icon = extract(exe).expect("a system executable must have an icon");
        assert!(icon.width > 0 && icon.height > 0);
        assert_eq!(icon.rgba.len(), (icon.width * icon.height * 4) as usize);
        assert!(
            icon.rgba.as_chunks::<4>().0.iter().any(|px| px[3] != 0),
            "an icon transparent everywhere means the alpha handling is wrong"
        );

        let (icon_png, grid_png) = extract_pngs(exe).unwrap();
        assert_eq!(&icon_png[1..4], b"PNG");
        assert_eq!(&grid_png[1..4], b"PNG");
    }

    #[cfg(windows)]
    #[test]
    fn a_missing_file_does_not_panic() {
        // Windows is entitled to hand back a generic "unknown file" icon here. What must not
        // happen is a panic, or a bitmap whose length disagrees with its dimensions.
        if let Ok(icon) = extract(Path::new(r"Z:\nothing\here.exe")) {
            assert_eq!(icon.rgba.len(), (icon.width * icon.height * 4) as usize);
        }
    }
}
