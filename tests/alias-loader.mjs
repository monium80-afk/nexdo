// Lets `node --test` run the app's own TypeScript modules as they are:
// Node 24 strips the types itself, and this resolves the "@/…" path alias
// (tsconfig.json) and the extensionless imports Metro allows. No test
// framework to install — see package.json "test".
import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"];

// Native modules and network services swapped for in-memory stand-ins, so the
// real stores can run under Node (tests/stubs). Everything else is the app's
// own code.
const STUBS = {
  "react-native": "tests/stubs/react-native.ts",
  "@react-native-async-storage/async-storage": "tests/stubs/async-storage.ts",
  "expo-web-browser": "tests/stubs/web-browser.ts",
  "@/lib/supabase": "tests/stubs/supabase.ts",
  "@/lib/api": "tests/stubs/api.ts",
  "@/lib/notifications": "tests/stubs/noop.ts",
  "@/lib/posthog": "tests/stubs/noop.ts",
  "@/lib/ai/media": "tests/stubs/noop.ts",
};

function findFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (STUBS[specifier]) base = resolvePath(root, STUBS[specifier]);
  else if (specifier.startsWith("@/")) base = resolvePath(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  const file = base ? findFile(base) : null;
  if (file) {
    const url = pathToFileURL(file).href;
    return { url, format: file.endsWith(".ts") ? "module-typescript" : undefined, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
