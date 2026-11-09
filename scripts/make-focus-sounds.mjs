// Makes the focus sounds a session can play (assets/sounds/focus-*.wav):
// rain, brown noise and waves, each a seamless loop built from filtered noise,
// so there's no third-party audio to license. Run it again after changing
// one: `node scripts/make-focus-sounds.mjs`. Played by lib/focusSound.ts.
//
// Each loop is rendered a second longer than it plays, and that extra second
// is crossfaded into its start, so the end runs straight into the beginning
// with no seam. 22.05 kHz mono keeps them small (~0.5 MB each); noise doesn't
// need more.
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 22_050;
const LOOP_SECONDS = 12;
const FADE_SECONDS = 1;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sounds");

// A fixed seed: running the script again makes the same files.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The coefficient of a one-pole low-pass at `hz`. */
const pole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / RATE);

function render(draw) {
  const length = Math.round((LOOP_SECONDS + FADE_SECONDS) * RATE);
  const samples = new Float64Array(length);
  draw(samples);
  // Crossfade the extra second into the start (equal power).
  const loop = Math.round(LOOP_SECONDS * RATE);
  const fade = length - loop;
  const out = new Float64Array(loop);
  for (let i = 0; i < loop; i += 1) {
    out[i] = i < fade ? samples[i] * Math.sqrt(i / fade) + samples[loop + i] * Math.sqrt(1 - i / fade) : samples[i];
  }
  // All three at about the same loudness, well under full scale.
  const rms = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0) / out.length);
  const gain = 0.07 / rms;
  return out.map((value) => Math.max(-0.6, Math.min(0.6, value * gain)));
}

function writeWav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(value * 32_767), i * 2));
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
  console.log(`${name}: ${(samples.length / RATE).toFixed(1)} s, peak ${peak.toFixed(2)}, ${(data.length / 1024).toFixed(0)} KB`);
}

// Brown noise: white noise summed up (with a little leak), its rumble kept
// and its drift removed.
writeWav(
  "focus-brown.wav",
  render((s) => {
    const next = random(11);
    let brown = 0;
    let slow = 0;
    for (let i = 0; i < s.length; i += 1) {
      brown = (brown + 0.02 * (next() * 2 - 1)) / 1.02;
      slow += pole(25) * (brown - slow);
      s[i] = brown - slow;
    }
  }),
);

// Rain: a soft hiss, a little low rumble, and a scatter of drops — short
// bursts of noise, each with its own brightness and loudness.
writeWav(
  "focus-rain.wav",
  render((s) => {
    const next = random(23);
    let low = 0;
    let high = 0;
    let rumble = 0;
    for (let i = 0; i < s.length; i += 1) {
      const white = next() * 2 - 1;
      low += pole(5000) * (white - low);
      high += pole(500) * (low - high);
      rumble = (rumble + 0.02 * white) / 1.02;
      s[i] = 0.55 * (low - high) + 0.9 * rumble;
    }
    const drops = Math.round(s.length / RATE) * 28;
    for (let d = 0; d < drops; d += 1) {
      const start = Math.floor(next() * s.length);
      const decay = 0.004 + next() * 0.012;
      const a = pole(1200 + next() * 5000);
      const loudness = 0.25 + next() ** 2 * 1.1;
      let y = 0;
      for (let j = 0; start + j < s.length; j += 1) {
        const t = j / RATE;
        const envelope = Math.exp(-t / decay);
        if (envelope < 1e-3) break;
        y += a * ((next() * 2 - 1) - y);
        s[start + j] += loudness * envelope * y;
      }
    }
  }),
);

// Waves: noise that swells and draws back every six seconds, brighter at the
// top of each wave. Six divides the loop's twelve, so the loop stays in step.
writeWav(
  "focus-waves.wav",
  render((s) => {
    const next = random(37);
    const period = 6;
    let brown = 0;
    let shaped = 0;
    for (let i = 0; i < s.length; i += 1) {
      const t = i / RATE;
      const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
      const swell = 0.2 + 0.8 * phase ** 1.6;
      const white = next() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      shaped += pole(250 + 2200 * phase ** 2) * (white - shaped);
      s[i] = swell * (0.8 * shaped + 2.5 * brown);
    }
  }),
);
