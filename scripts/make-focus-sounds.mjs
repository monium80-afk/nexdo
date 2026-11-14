// Makes the focus sounds a session can play (assets/sounds/focus-*.m4a) from
// the long nature recordings the user picked (2026-11-10). Each recording is
// 2–8 hours and 170–690 MB, far too big to ship, so this cuts one stretch out
// of the middle of each and turns it into a seamless loop:
//
//   1. take LOOP seconds starting at START (well past any intro), plus the FADE after it,
//   2. crossfade the extra FADE seconds into the start (equal power), so the
//      end runs straight into the beginning with no seam,
//   3. level every loop to the same loudness, so switching sounds doesn't jump,
//   4. encode 44.1 kHz stereo AAC at 64 kb/s (~0.5 MB a minute).
//
// Run it again after swapping a recording:
//   node scripts/make-focus-sounds.mjs "<folder with the .mp3s>"
// Needs ffmpeg on PATH. Played by lib/focusSound.ts.
import { execFileSync, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = process.argv[2];
if (!SOURCE_DIR) {
  console.error('Usage: node scripts/make-focus-sounds.mjs "<folder with the .mp3s>"');
  process.exit(1);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sounds");

const FADE = 4; // seconds blended across the loop point
const LOUDNESS = -24; // LUFS, the same for every loop
const BITRATE = "64k";

// start / loop in seconds. Thunder loops longer, so the claps repeat less often.
const LOOPS = [
  { out: "focus-rain.m4a", source: "rain.mp3", start: 1800, loop: 300 },
  { out: "focus-waves.m4a", source: "Ocean Waves, Wave Noise,.mp3", start: 1800, loop: 300 },
  { out: "focus-thunder.m4a", source: "Rain and Thunder Sounds.mp3", start: 3600, loop: 480 },
  { out: "focus-stream.m4a", source: "Relaxing River Sounds.mp3", start: 1800, loop: 300 },
  { out: "focus-forest.m4a", source: "Forest Sounds.mp3", start: 1800, loop: 300 },
  { out: "focus-fireplace.m4a", source: "Campfire Sounds & Soft Crackling.mp3", start: 1800, loop: 300 },
];

/**
 * The crossfade part of the filter graph, ending in [looped]. Input 0 is the
 * loop, input 1 the FADE seconds right after it (the file is opened twice, so
 * ffmpeg never has to hold the whole loop in memory to reach its tail).
 */
function loopFilter() {
  return [
    // The loop itself, its first FADE seconds fading in…
    `[0:a]asetpts=PTS-STARTPTS,afade=t=in:d=${FADE}:curve=qsin[body]`,
    // …under the FADE seconds that come after it, fading out.
    `[1:a]asetpts=PTS-STARTPTS,afade=t=out:d=${FADE}:curve=qsin[tail]`,
    `[body][tail]amix=inputs=2:duration=first:normalize=0[looped]`,
  ].join(";");
}

function ffmpeg(args) {
  return execFileSync("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

for (const { out, source, start, loop } of LOOPS) {
  const file = join(SOURCE_DIR, source);
  const input = [
    "-ss", String(start), "-t", String(loop), "-i", file,
    "-ss", String(start + loop), "-t", String(FADE), "-i", file,
    "-vn", // skip the cover art
  ];

  // Pass 1: measure the loop's loudness (loudnorm reports on stderr).
  const pass1 = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", ...input, "-filter_complex", `${loopFilter()};[looped]loudnorm=I=${LOUDNESS}:TP=-2:print_format=json`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  if (pass1.status !== 0) throw new Error(`Couldn't read ${source}: ${pass1.stderr}`);
  const report = pass1.stderr;
  const measured = JSON.parse(report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1));

  // Pass 2: level it (linear gain, no pumping) and encode.
  const level = [
    `loudnorm=I=${LOUDNESS}:TP=-2:linear=true`,
    `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
  ].join(":");
  ffmpeg([
    ...input,
    "-filter_complex",
    `${loopFilter()};[looped]${level},aresample=44100[final]`,
    "-map", "[final]",
    "-c:a", "aac", "-b:a", BITRATE, "-ac", "2",
    join(OUT, out),
  ]);

  const mb = (statSync(join(OUT, out)).size / 1_048_576).toFixed(1);
  console.log(`${out}: ${loop / 60} min from ${source} at ${start / 60} min, was ${Number(measured.input_i).toFixed(1)} LUFS, ${mb} MB`);
}
