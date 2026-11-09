// Makes the app's four short sounds (assets/sounds/*.wav) from plain sine
// waves, so there's no third-party audio to license. Run it again after
// changing a sound: `node scripts/make-sounds.mjs`. Played by lib/sounds.ts.
//
// Each note is a few soft partials with a quick attack and a smooth decay —
// bell- or marimba-like, never a beep — and everything is kept quiet (peaks at
// about a quarter of full scale), so a sound sits under the moment instead of
// on top of it.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44_100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sounds");

/** One note: `partials` are [frequency multiple, loudness]; `decay` is the time constant in seconds. */
function note(samples, { at, freq, decay, gain, attack = 0.004, partials = [[1, 1]] }) {
  const start = Math.round(at * RATE);
  for (let i = start; i < samples.length; i += 1) {
    const t = (i - start) / RATE;
    const envelope = Math.min(1, t / attack) * Math.exp(-t / decay);
    if (envelope < 1e-4 && t > attack) break;
    let value = 0;
    for (const [multiple, loudness] of partials) value += loudness * Math.sin(2 * Math.PI * freq * multiple * t);
    samples[i] += gain * envelope * value;
  }
}

/** A swell: rises over `rise`, then fades over `fall`. */
function swell(samples, { at, freqs, rise, fall, gain }) {
  const start = Math.round(at * RATE);
  const length = Math.round((rise + fall) * RATE);
  for (let i = 0; i < length && start + i < samples.length; i += 1) {
    const t = i / RATE;
    const envelope = t < rise ? Math.sin((Math.PI / 2) * (t / rise)) ** 2 : Math.cos((Math.PI / 2) * ((t - rise) / fall)) ** 2;
    let value = 0;
    for (const freq of freqs) value += Math.sin(2 * Math.PI * freq * t);
    samples[start + i] += (gain / freqs.length) * envelope * value;
  }
}

function render(seconds, draw) {
  const samples = new Float64Array(Math.round(seconds * RATE));
  draw(samples);
  // The last 30 ms always fade to silence, so nothing ends in a click.
  const fade = Math.round(0.03 * RATE);
  for (let i = 0; i < fade; i += 1) samples[samples.length - 1 - i] *= i / fade;
  return samples;
}

function writeWav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(OUT, name), Buffer.concat([header, data]));
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  console.log(`${name}: ${(samples.length / RATE).toFixed(2)} s, peak ${peak.toFixed(2)}`);
}

// Marimba-like: the fundamental, a quiet octave and the bar's 4th partial.
const MARIMBA = [
  [1, 1],
  [2, 0.18],
  [3.93, 0.06],
];
// Bell-like, for the chime.
const BELL = [
  [1, 1],
  [2, 0.3],
  [3, 0.1],
  [4.2, 0.05],
];

// A task done: two notes a fifth apart, rising (E5 → B5).
writeWav(
  "task-complete.wav",
  render(0.6, (s) => {
    note(s, { at: 0, freq: 659.25, decay: 0.16, gain: 0.17, partials: MARIMBA });
    note(s, { at: 0.085, freq: 987.77, decay: 0.2, gain: 0.17, partials: MARIMBA });
  }),
);

// A step ticked off: one short, light tick (G6).
writeWav(
  "step-check.wav",
  render(0.14, (s) => {
    note(s, { at: 0, freq: 1567.98, decay: 0.03, gain: 0.16, attack: 0.002, partials: [[1, 1], [2, 0.12]] });
  }),
);

// The day's last task done: C5 E5 G5 C6, rolled like a small chime.
writeWav(
  "day-done.wav",
  render(1.4, (s) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
      note(s, { at: index * 0.11, freq, decay: 0.32, gain: 0.1, attack: 0.006, partials: BELL });
    });
  }),
);

// A focus session opening: a soft swell on G4 and D5, no attack to it.
writeWav(
  "session-start.wav",
  render(0.75, (s) => {
    swell(s, { at: 0, freqs: [392.0, 587.33, 784.0], rise: 0.22, fall: 0.5, gain: 0.16 });
  }),
);
