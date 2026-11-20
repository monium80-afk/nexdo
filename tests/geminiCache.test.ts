/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GeminiTimeoutError, generateStructuredJson } from "@/lib/ai/gemini";

describe("Gemini prompt cache deadlines", () => {
  it("stops waiting for shared cache acquisition when the call budget expires", async (t) => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Promise<Response>(() => {}));
    const started = Date.now();

    await assert.rejects(
      generateStructuredJson({
        label: "cache-deadline-test",
        systemPrompt: `unique prompt ${started}`,
        userContent: "{}",
        responseSchema: {},
        cacheSystemPrompt: true,
        deadline: started + 50,
      }),
      GeminiTimeoutError,
    );

    assert.ok(Date.now() - started < 500);
    assert.equal(fetchMock.mock.callCount(), 1, "the expired call should not start a Gemini generation request");
  });
});
