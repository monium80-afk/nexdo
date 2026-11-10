// Makes the focus sounds a session can play (assets/sounds/focus-*.wav):
// rain, waves, thunderstorm, stream, forest, fireplace and café, each a
// seamless loop synthesised from noise and tones, so there's no third-party
// audio to license. Run it again after changing one:
// `node scripts/make-focus-sounds.mjs`. Played by lib/focusSound.ts.
// (Brown noise was removed 2026-11-09.)
//
// Each loop is rendered a second longer than it plays, and that extra second
// is crossfaded into its start, so the end runs straight into the beginning
// with no seam. 22.05 kHz mono keeps them small (~0.5 MB per 12 s); noise
// doesn't need more. The busier scenes loop over 24 s so the repeat is
// harder to hear.
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

/**
 * An RBJ biquad ("lowpass" | "highpass" | "bandpass"), returned as a function
 * of one sample. `retune` changes its frequency without resetting it.
 */
function biquad(type, hz, q = Math.SQRT1_2) {
  let b0, b1, b2, a1, a2;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (f) => {
    const w = (2 * Math.PI * f) / RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === "lowpass") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (type === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [b0, b1, b2] = [alpha, 0, -alpha];
    [b0, b1, b2, a1, a2] = [b0 / a0, b1 / a0, b2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
  };
  set(hz);
  const run = (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
  run.retune = set;
  return run;
}

/**
 * `soft` rounds off peaks (thunder) instead of clipping them; the original
 * three sounds keep the hard limit so they come out exactly as before.
 */
function render(draw, { seconds = LOOP_SECONDS, soft = false } = {}) {
  const length = Math.round((seconds + FADE_SECONDS) * RATE);
  const samples = new Float64Array(length);
  draw(samples);
  // Crossfade the extra second into the start (equal power).
  const loop = Math.round(seconds * RATE);
  const fade = length - loop;
  const out = new Float64Array(loop);
  for (let i = 0; i < loop; i += 1) {
    out[i] = i < fade ? samples[i] * Math.sqrt(i / fade) + samples[loop + i] * Math.sqrt(1 - i / fade) : samples[i];
  }
  // All of them at about the same loudness, well under full scale.
  const rms = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0) / out.length);
  const gain = 0.07 / rms;
  return out.map((value) =>
    soft ? 0.6 * Math.tanh((value * gain) / 0.6) : Math.max(-0.6, Math.min(0.6, value * gain)),
  );
}

/** Adds one short burst of filtered noise (a drop, a crackle) at `start`. */
function burst(s, next, start, { decay, hz, loudness, type = "lowpass" }) {
  const filter = type === "lowpass" ? null : biquad(type, hz, 0.9);
  const a = pole(hz);
  let y = 0;
  for (let j = 0; start + j < s.length; j += 1) {
    const envelope = Math.exp(-j / RATE / decay);
    if (envelope < 1e-3) break;
    const white = next() * 2 - 1;
    y = filter ? filter(white) : y + a * (white - y);
    s[start + j] += loudness * envelope * y;
  }
}

/** A pitched blip whose frequency follows `freqAt(t)` — birdsong, bubbles, clinks. */
function tone(s, start, duration, freqAt, envelopeAt, loudness) {
  let phase = 0;
  const n = Math.round(duration * RATE);
  for (let j = 0; j < n && start + j < s.length; j += 1) {
    const t = j / RATE;
    phase += (2 * Math.PI * freqAt(t)) / RATE;
    s[start + j] += loudness * envelopeAt(t, duration) * Math.sin(phase);
  }
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

// Rain: a soft hiss, a little low rumble, and a scatter of drops — short
// bursts of noise, each with its own brightness and loudness. Also the bed
// under the thunderstorm.
function drawRain(s, next) {
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
}

writeWav("focus-rain.wav", render((s) => drawRain(s, random(23))));

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

const rmsOf = (s) => Math.sqrt(s.reduce((sum, value) => sum + value * value, 0) / s.length);
const peakOf = (s) => s.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

/** Mixes `part` into `s`, scaled so its loudest moment is `peak`. */
function mixAtPeak(s, part, peak, offset = 0) {
  const scale = peak / (peakOf(part) || 1);
  for (let j = 0; j < part.length && offset + j < s.length; j += 1) s[offset + j] += part[j] * scale;
}

// Thunderstorm: the rain, with a close strike (a crack sliding down into a
// long rumble) and a softer, distant one later in the loop.
function rumble(next, { attack, decay, from, to }) {
  const length = Math.round((attack + decay * 5) * RATE);
  const out = new Float64Array(length);
  const lp1 = biquad("lowpass", from);
  const lp2 = biquad("lowpass", from);
  let flutter = 1;
  let target = 1;
  for (let j = 0; j < length; j += 1) {
    const t = j / RATE;
    // The filter falls from a bright crack to a low roll over the first second.
    if (j % 64 === 0) {
      const cutoff = to + (from - to) * Math.exp(-t / 0.35);
      lp1.retune(cutoff);
      lp2.retune(cutoff);
    }
    if (j % Math.round(0.12 * RATE) === 0) target = 0.35 + next() * 1.3;
    flutter += pole(9) * (target - flutter);
    const envelope = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    out[j] = lp2(lp1(next() * 2 - 1)) * envelope * flutter;
  }
  return out;
}

writeWav(
  "focus-thunder.wav",
  render(
    (s) => {
      const next = random(41);
      drawRain(s, next);
      const bed = rmsOf(s);
      mixAtPeak(s, rumble(next, { attack: 0.06, decay: 1.8, from: 1400, to: 130 }), bed * 9, Math.round(3.5 * RATE));
      mixAtPeak(s, rumble(next, { attack: 0.9, decay: 2.2, from: 380, to: 110 }), bed * 4.5, Math.round(13.5 * RATE));
    },
    { seconds: 24, soft: true },
  ),
);

// Stream: water rushing over stones — band-passed noise that gurgles in
// loudness — with lots of small rising bubbles on top.
writeWav(
  "focus-stream.wav",
  render((s) => {
    const next = random(53);
    const band = biquad("bandpass", 1300, 0.55);
    const low = biquad("lowpass", 420);
    let gurgle = 1;
    let target = 1;
    const step = Math.round(0.045 * RATE);
    for (let i = 0; i < s.length; i += 1) {
      const white = next() * 2 - 1;
      if (i % step === 0) target = 0.45 + next() * 1.0;
      gurgle += pole(14) * (target - gurgle);
      s[i] = 0.6 * band(white) * gurgle + 0.35 * low(white);
    }
    const bed = rmsOf(s);
    const bubbles = Math.round(s.length / RATE) * 55;
    for (let b = 0; b < bubbles; b += 1) {
      const start = Math.floor(next() * s.length);
      const f0 = 380 + next() ** 1.6 * 1500;
      const tau = 0.006 + next() * 0.026;
      const rise = 3 + next() * 7;
      tone(
        s,
        start,
        tau * 6,
        (t) => f0 * (1 + rise * t),
        (t) => Math.min(1, t / 0.002) * Math.exp(-t / tau),
        bed * (0.35 + next() ** 2 * 1.6),
      );
    }
  }),
);

// Forest: wind in the trees that gusts and settles, a rustle of leaves riding
// on it, and birds calling now and then — three kinds, near and far.
function bird(s, next, start, kind, loudness) {
  const shape = (t, d) => Math.sin((Math.PI * t) / d) ** 2;
  if (kind === 0) {
    // Tweets: quick falling chirps.
    const notes = 3 + Math.floor(next() * 3);
    const top = 3800 + next() * 900;
    for (let n = 0; n < notes; n += 1) {
      tone(s, start + Math.round(n * 0.11 * RATE), 0.07, (t) => top - 1300 * (t / 0.07), shape, loudness);
    }
  } else if (kind === 1) {
    // A two-note whistle, the second higher.
    const base = 2300 + next() * 600;
    tone(s, start, 0.2, (t) => base + 25 * Math.sin(2 * Math.PI * 28 * t), shape, loudness);
    tone(s, start + Math.round(0.26 * RATE), 0.22, (t) => base * 1.26 + 25 * Math.sin(2 * Math.PI * 28 * t), shape, loudness);
  } else {
    // A trill: a run of tiny chirps.
    const notes = 9 + Math.floor(next() * 7);
    for (let n = 0; n < notes; n += 1) {
      tone(s, start + Math.round(n * 0.045 * RATE), 0.032, (t) => 5200 - 900 * (t / 0.032), shape, loudness * 0.8);
    }
  }
}

writeWav(
  "focus-forest.wav",
  render(
    (s) => {
      const next = random(61);
      const windTone = biquad("lowpass", 520);
      const leaves = biquad("highpass", 2600);
      let brown = 0;
      for (let i = 0; i < s.length; i += 1) {
        const t = i / RATE;
        // Two slow gusts; 12 and 8 both divide the 24-second loop.
        const gust = 0.55 + 0.25 * Math.sin((2 * Math.PI * t) / 12) + 0.2 * Math.sin((2 * Math.PI * t) / 8 + 1);
        const white = next() * 2 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        s[i] = gust * 2.2 * windTone(brown) + Math.max(0, gust - 0.45) * 0.15 * leaves(white);
      }
      const bed = rmsOf(s);
      let t = 0.6;
      while (t < 22.8) {
        bird(s, next, Math.round(t * RATE), Math.floor(next() * 3), bed * (0.6 + next() ** 1.5 * 2.2));
        t += 1.4 + next() * 2.6;
      }
    },
    { seconds: 24 },
  ),
);

// Fireplace: the low roar of the fire, a faint hiss, and crackles — mostly
// tiny ticks, sometimes in a quick cluster, with the odd bigger pop.
writeWav(
  "focus-fireplace.wav",
  render(
    (s) => {
      const next = random(71);
      const roarTone = biquad("lowpass", 260);
      const hiss = biquad("highpass", 3200);
      let brown = 0;
      for (let i = 0; i < s.length; i += 1) {
        const t = i / RATE;
        const breath = 0.8 + 0.2 * Math.sin((2 * Math.PI * t) / 6);
        const white = next() * 2 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        s[i] = breath * (3 * roarTone(brown) + 0.012 * hiss(white));
      }
      const bed = rmsOf(s);
      const crackle = (start) =>
        burst(s, next, start, {
          type: "highpass",
          hz: 1800 + next() * 3500,
          decay: 0.0006 + next() * 0.0025,
          loudness: bed * (1.2 + next() ** 3 * 9),
        });
      let t = 0;
      while (t < s.length / RATE) {
        const start = Math.round(t * RATE);
        crackle(start);
        // Now and then a quick cluster.
        if (next() < 0.14) {
          const count = 3 + Math.floor(next() * 6);
          for (let c = 0; c < count; c += 1) crackle(start + Math.round(next() * 0.18 * RATE));
        }
        t += -Math.log(1 - next()) / 5;
      }
      // A few bigger, rounder pops.
      for (let p = 0; p < 9; p += 1) {
        burst(s, next, Math.floor(next() * s.length), {
          type: "bandpass",
          hz: 600 + next() * 900,
          decay: 0.004 + next() * 0.008,
          loudness: bed * (6 + next() * 8),
        });
      }
    },
    { seconds: 24, soft: true },
  ),
);

// Café: a room of distant conversations — voiced syllables through vowel
// formants, several people, each talking and pausing — muffled so no words
// come through, over a little room tone, with a cup clinking now and then.
const VOWELS = [
  [730, 1090], [270, 2290], [300, 870], [530, 1840], [660, 1720], [490, 1350], [400, 2000], [570, 840],
];

function voice(next, length) {
  const out = new Float64Array(length);
  const pitch = 95 + next() * 140;
  const f1 = biquad("bandpass", 500, 5);
  const f2 = biquad("bandpass", 1500, 8);
  let phase = next();
  let i = Math.floor(next() * 2 * RATE);
  while (i < length) {
    // One turn of talking, then a pause.
    const turnEnd = Math.min(length, i + Math.round((1.5 + next() * 3.5) * RATE));
    while (i < turnEnd) {
      const syllable = Math.round((0.11 + next() * 0.2) * RATE);
      const [v1, v2] = VOWELS[Math.floor(next() * VOWELS.length)];
      f1.retune(v1 * (0.9 + next() * 0.2));
      f2.retune(v2 * (0.9 + next() * 0.2));
      const level = 0.45 + next() * 0.55;
      const glide = (next() - 0.5) * 0.25;
      for (let j = 0; j < syllable && i < length; j += 1, i += 1) {
        const u = j / syllable;
        phase += (pitch * (1 + glide * u)) / RATE;
        phase -= Math.floor(phase);
        const source = 2 * phase - 1 + 0.12 * (next() * 2 - 1);
        out[i] = level * Math.sin(Math.PI * u) ** 0.8 * (f1(source) + 0.6 * f2(source));
      }
    }
    i += Math.round((0.5 + next() * 2.5) * RATE);
  }
  return out;
}

writeWav(
  "focus-cafe.wav",
  render(
    (s) => {
      const next = random(83);
      for (let v = 0; v < 8; v += 1) {
        const part = voice(next, s.length);
        const distance = 0.3 + next() * 0.7;
        for (let i = 0; i < s.length; i += 1) s[i] += part[i] * distance;
      }
      // Muffle the room so it's murmur, not words.
      const muffle1 = biquad("lowpass", 1900);
      const muffle2 = biquad("lowpass", 1900);
      const room = biquad("lowpass", 300);
      for (let i = 0; i < s.length; i += 1) s[i] = muffle2(muffle1(s[i]));
      const murmur = rmsOf(s);
      let brown = 0;
      for (let i = 0; i < s.length; i += 1) {
        brown = (brown + 0.02 * (next() * 2 - 1)) / 1.02;
        s[i] += room(brown) * murmur * 6;
      }
      // Cups and spoons: a few bright, quickly fading rings.
      for (let c = 0; c < 7; c += 1) {
        const start = Math.floor(next() * (s.length - RATE));
        const f0 = 1800 + next() * 1400;
        const loudness = murmur * (0.8 + next() * 1.4);
        [[1, 0.28, 1], [2.32, 0.16, 0.6], [4.25, 0.08, 0.35]].forEach(([ratio, decay, gain]) =>
          tone(s, start, decay * 6, () => f0 * ratio, (t) => Math.min(1, t / 0.001) * Math.exp(-t / decay), loudness * gain),
        );
        // Often a second, softer clink right after.
        if (next() < 0.5) {
          const again = start + Math.round((0.12 + next() * 0.25) * RATE);
          tone(s, again, 1.2, () => f0 * 1.04, (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.2), loudness * 0.5);
        }
      }
    },
    { seconds: 24 },
  ),
);
