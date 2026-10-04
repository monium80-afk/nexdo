// Copies the values the hosted server needs from .env into the EAS project's
// "production" environment, where `eas deploy --environment production` reads
// them. Run it again whenever one of these values changes, then redeploy.
//
//   node scripts/push-server-env.mjs
//
// Prints names only, never values. The three keys are stored as "sensitive"
// (EAS Hosting can't use "secret" ones); the two EXPO_PUBLIC_ values are
// public anyway and stored as plain text.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

const wanted = [
  ["GEMINI_API_KEY", "sensitive"],
  ["CLERK_SECRET_KEY", "sensitive"],
  ["SUPABASE_SECRET_KEY", "sensitive"],
  ["EXPO_PUBLIC_SUPABASE_URL", "plaintext"],
  ["EXPO_PUBLIC_REVENUECAT_TEST_API_KEY", "plaintext"],
];

for (const [name, visibility] of wanted) {
  const value = env[name];
  if (!value) throw new Error(`${name} is missing from .env`);
  // The value goes through the shell, so refuse anything that would need escaping.
  if (!/^[A-Za-z0-9_\-.:/]+$/.test(value)) throw new Error(`${name} has characters that can't be passed safely`);
  const result = spawnSync(
    `npx --yes eas-cli env:create production --name ${name} --value "${value}" --visibility ${visibility} --type string --scope project --force --non-interactive`,
    { shell: true, cwd: project, encoding: "utf8" },
  );
  const output = `${result.stdout}\n${result.stderr}`.split(value).join("<hidden>");
  const lastLine = output
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/Clerk (iOS|Android) plugin/.test(line))
    .pop();
  console.log(`${name} (${visibility}) -> ${result.status === 0 ? "ok" : `FAILED (exit ${result.status})`}: ${lastLine?.trim().slice(0, 160)}`);
  if (result.status !== 0) process.exitCode = 1;
}
