#!/usr/bin/env node
/**
 * Generate the five UI sounds for a theme package - zero dependencies, just a small PCM WAV
 * encoder. These are original synthesised tones, deliberately soft and short: a console UI
 * plays `move` on every focus change, so anything sharp becomes irritating within a minute.
 *
 *   node scripts/generate-sounds.mjs themes/aura-default/sounds
 *
 * Slots (see SOUND_SLOTS in crates/aura-core/src/theme/manifest.rs):
 *   move   - focus moved to a neighbouring tile
 *   select - item activated
 *   back   - went up a level / cancelled
 *   launch - a game or app is starting
 *   error  - something refused to happen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITS = 16;

/** Encode mono float samples in -1..1 as a 16-bit PCM WAV buffer. */
function encodeWav(samples) {
  const bytesPerSample = BITS / 8;
  const dataSize = samples.length * bytesPerSample * CHANNELS;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(BITS, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
  }
  return buffer;
}

/**
 * Render `duration` seconds with a per-sample callback.
 * `voice(t, progress)` returns an amplitude in -1..1 before the envelope is applied.
 */
function render(duration, voice, { attack = 0.005, release = 0.06 } = {}) {
  const total = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(total);
  const attackSamples = Math.max(1, Math.floor(SAMPLE_RATE * attack));
  const releaseSamples = Math.max(1, Math.floor(SAMPLE_RATE * release));

  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / total;

    // Linear attack, cosine release - no clicks at either end.
    let envelope = 1;
    if (i < attackSamples) envelope = i / attackSamples;
    const fromEnd = total - i;
    if (fromEnd < releaseSamples) {
      envelope *= 0.5 * (1 - Math.cos((Math.PI * fromEnd) / releaseSamples));
    }
    samples[i] = voice(t, progress) * envelope;
  }
  return samples;
}

const sine = (t, freq) => Math.sin(2 * Math.PI * freq * t);
/** Exponential glide from `from` Hz to `to` Hz - phase-correct, so no zipper noise. */
const glide = (t, progress, from, to) => {
  const freq = from * Math.pow(to / from, progress);
  return Math.sin(2 * Math.PI * freq * t);
};

const SOUNDS = {
  // Soft, low, very short: this plays on every single D-pad press.
  move: () =>
    render(0.07, (t) => 0.22 * sine(t, 660) + 0.06 * sine(t, 1320), {
      attack: 0.002,
      release: 0.05,
    }),

  // A bright two-note confirmation, a perfect fifth apart.
  select: () =>
    render(0.16, (t, p) => {
      const first = 0.26 * sine(t, 784);
      const second = p > 0.35 ? 0.24 * sine(t, 1175) : 0;
      return first * (1 - p * 0.5) + second;
    }),

  // Same idea as select, inverted: falls instead of rises.
  back: () =>
    render(0.14, (t, p) => {
      const first = 0.24 * sine(t, 587);
      const second = p > 0.35 ? 0.2 * sine(t, 440) : 0;
      return first * (1 - p * 0.6) + second;
    }),

  // A rising sweep with a fifth above it - the "something is happening" cue.
  launch: () =>
    render(0.55, (t, p) => 0.2 * glide(t, p, 330, 990) + 0.08 * glide(t, p, 495, 1485), {
      attack: 0.02,
      release: 0.2,
    }),

  // Detuned low pair: dissonant enough to read as "no" without being harsh.
  error: () =>
    render(0.26, (t) => 0.2 * sine(t, 220) + 0.16 * sine(t, 233), {
      attack: 0.004,
      release: 0.12,
    }),
};

const outDir = resolve(process.argv[2] ?? 'themes/aura-default/sounds');
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const [name, build] of Object.entries(SOUNDS)) {
  const wav = encodeWav(build());
  const file = resolve(outDir, `${name}.wav`);
  writeFileSync(file, wav);
  total += wav.length;
  console.log(`  ${name}.wav  ${String(wav.length).padStart(7)} bytes`);
}
console.log(`\nWrote ${Object.keys(SOUNDS).length} sounds (${total} bytes) to ${outDir}`);
