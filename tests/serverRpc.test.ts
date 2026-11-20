/// <reference types="node" />
import assert from "node:assert/strict";
import { it } from "node:test";

import { emptyServerFolder } from "@/lib/serverRpc";

it("recursively deletes storage objects without treating folder entries as files", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const listed = new Map<string, number>();
  const deleted: string[][] = [];
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SECRET_KEY = "test-key";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "https://supabase.example/storage/v1/object/list/test-bucket" && method === "POST") {
      const { prefix } = JSON.parse(String(init?.body)) as { prefix: string };
      const count = listed.get(prefix) ?? 0;
      listed.set(prefix, count + 1);
      const entries =
        count > 0
          ? []
          : prefix === "user"
            ? [
                { name: "nested", id: null, metadata: null },
                { name: "root.txt", id: "root-id", metadata: { mimetype: "text/plain" } },
              ]
            : prefix === "user/nested"
              ? [
                  { name: "deep", id: null, metadata: null },
                  { name: "child.txt", id: "child-id", metadata: { mimetype: "text/plain" } },
                ]
              : [{ name: "file.txt", id: "file-id", metadata: { mimetype: "text/plain" } }];
      return new Response(JSON.stringify(entries), { status: 200 });
    }

    if (url !== "https://supabase.example/storage/v1/object/test-bucket" || method !== "DELETE") {
      throw new Error(`unexpected storage request: ${method} ${url}`);
    }
    const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] };
    deleted.push(prefixes);
    return new Response(JSON.stringify(prefixes), { status: 200 });
  }) as typeof fetch;

  try {
    await emptyServerFolder("test-bucket", "user");
    assert.deepEqual(deleted.flat(), ["user/nested/deep/file.txt", "user/nested/child.txt", "user/root.txt"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
