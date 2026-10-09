// Copies the values the hosted server needs from .env into the EAS project's
// "production" environment, where `eas deploy --environment production` reads
// them. Run it again whenever one of these values changes, then redeploy.
//
//   node scripts/push-server-env.mjs
//   node scripts/push-server-env.mjs NAME …   (only these — one value changed)
//
// The server checks Pro with RevenueCat's store keys (lib/serverPlan.ts); the
// Test Store key is for development only and isn't pushed.
//
// Prints names only, never values. The values never go on a command line,
// where anyone else on the machine could read them from the process list:
// they're written to a private temporary file that `eas env:push` uploads,
// and the file is deleted straight after. env:push stores the EXPO_PUBLIC_
// values (public anyway) as plain text and the three keys as "sensitive" —
// what EAS Hosting needs ("secret" ones it can't use).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(join(project, ".env"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

const serverNames = [
  "GEMINI_API_KEY",
  "CLERK_SECRET_KEY",
  "SUPABASE_SECRET_KEY",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY",
  "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY",
];

const only = process.argv.slice(2);
for (const name of only) {
  if (!serverNames.includes(name)) throw new Error(`${name} isn't one the server uses: ${serverNames.join(", ")}`);
}
const wanted = only.length > 0 ? only : serverNames;

const lines = wanted.map((name) => {
  const value = env[name];
  if (!value) throw new Error(`${name} is missing from .env`);
  // Single quotes keep a value exactly as it is in a .env file; one that
  // holds a quote or a line break can't be written that way.
  if (/['\r\n]/.test(value)) throw new Error(`${name} has characters that can't be written to the upload file`);
  return `${name}='${value}'`;
});

// A folder only this user can open (0700, and a per-user TEMP on Windows).
const folder = mkdtempSync(join(tmpdir(), "nexdo-env-"));
const file = join(folder, "server.env");
let result;
try {
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  // A shell only because Windows can't start npx without one; nothing secret
  // is in this command. No input: a question from eas fails at once instead of hanging.
  result = spawnSync(`npx --yes eas-cli env:push --environment production --path "${file}" --force`, {
    shell: true,
    cwd: project,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} finally {
  rmSync(folder, { recursive: true, force: true });
}

let output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
for (const name of wanted) output = output.split(env[name]).join("<hidden>");
const lastLine = output
  .split(/\r?\n/)
  .filter((line) => line.trim() && !/Clerk (iOS|Android) plugin/.test(line))
  .pop();
console.log(`${wanted.join(", ")} -> ${result.status === 0 ? "ok" : `FAILED (exit ${result.status})`}: ${lastLine?.trim().slice(0, 200)}`);
if (result.status !== 0) process.exitCode = 1;
