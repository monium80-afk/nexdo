// Makes assets/sounds/nexdo_alarm.wav — the alarm a task can ring with
// (2026-11-18). One file serves twice: the in-app alarm screen loops it
// (app/alarm.tsx), and the phone plays it for the alarm notification while
// Nexdo is closed (bundled by the expo-notifications plugin in app.json; iOS
// allows up to 30 s, Android needs a lowercase name with underscores).
//
// The pattern: four quick two-tone beeps, a short rest, repeated — a classic
// alarm clock, warm rather than shrill. Run: node scripts/make-alarm-sound.mjs

import { writeFileSync } from "node:fs";

const RATE = 22050;
const SECONDS = 12;
const samples = new Int16Array(RATE * SECONDS);

const BEEP = 0.09; // seconds per beep
const GAP = 0.05; // between beeps
const REST = 0.45; // after a burst of four
const BURST = 4 * (BEEP + GAP) + REST;

for (let i = 0; i < samples.length; i += 1) {
  const time = i / RATE;
  const inBurst = time % BURST;
  const slot = Math.floor(inBurst / (BEEP + GAP));
  const inBeep = inBurst - slot * (BEEP + GAP);
  if (slot > 3 || inBeep > BEEP) continue;
  // Alternating notes, with a soft attack and release so there are no clicks.
  const frequency = slot % 2 === 0 ? 1046.5 : 1318.5;
  const envelope = Math.min(1, inBeep / 0.006, (BEEP - inBeep) / 0.012);
  const tone = Math.sin(2 * Math.PI * frequency * time) * 0.8 + Math.sin(2 * Math.PI * frequency * 2 * time) * 0.2;
  samples[i] = Math.round(tone * envelope * 0.7 * 32767);
}

const data = Buffer.from(samples.buffer);
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

writeFileSync(new URL("../assets/sounds/nexdo_alarm.wav", import.meta.url), Buffer.concat([header, data]));
console.log("Wrote assets/sounds/nexdo_alarm.wav");
