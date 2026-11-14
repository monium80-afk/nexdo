/// <reference types="node" />
// Live voice's pure parts: reading Gemini Live's messages and the audio
// encoding. The message shapes are what gemini-3.8-live really sent on
// 2026-09-29, plus the variants the docs describe.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { audioLevel, decodeUtf8, encodeBase64, parseServerMessage, toMonoPcm16 } from "@/lib/liveProtocol";

describe("parseServerMessage", () => {
  it("reads setup, the start and end of speech and what was heard", () => {
    assert.deepEqual(parseServerMessage({ setupComplete: {} }), [{ type: "ready" }]);
    assert.deepEqual(parseServerMessage({ voiceActivity: { type: "ACTIVITY_START", audioOffset: "0.920s" } }), [{ type: "speechStart" }]);
    assert.deepEqual(parseServerMessage({ voiceActivity: { type: "ACTIVITY_END", audioOffset: "4.280s" } }), [{ type: "speechEnd" }]);
    assert.deepEqual(parseServerMessage({ serverContent: { inputTranscription: { text: "Delete the gym task." } } }), [
      { type: "transcript", text: "Delete the gym task." },
    ]);
  });

  it("reads a batch of tool calls", () => {
    assert.deepEqual(
      parseServerMessage({
        toolCall: {
          functionCalls: [
            { name: "add_task", args: { dueDatePhrase: "tomorrow at 6 pm", title: "Call mom" }, id: "call_846822" },
            { name: "undo_last_change", id: "call_846823" },
          ],
        },
      }),
      [
        {
          type: "toolCalls",
          calls: [
            { id: "call_846822", name: "add_task", args: { dueDatePhrase: "tomorrow at 6 pm", title: "Call mom" } },
            { id: "call_846823", name: "undo_last_change", args: {} },
          ],
        },
      ],
    );
  });

  it("reads the single-call shape one guide shows", () => {
    assert.deepEqual(parseServerMessage({ toolCall: { id: "call_1", functionName: "complete_task", args: { taskId: "t2" } } }), [
      { type: "toolCalls", calls: [{ id: "call_1", name: "complete_task", args: { taskId: "t2" } }] },
    ]);
  });

  it("reads the end of a turn with what it cost", () => {
    assert.deepEqual(
      parseServerMessage({
        serverContent: { turnComplete: true },
        usageMetadata: { promptTokenCount: 2706, responseTokenCount: 24, thoughtsTokenCount: 56 },
      }),
      [
        { type: "turnComplete" },
        { type: "usage", promptTokens: 2706, responseTokens: 24, thoughtsTokens: 56 },
      ],
    );
  });

  it("ignores what means nothing here", () => {
    assert.deepEqual(parseServerMessage({}), []);
    assert.deepEqual(parseServerMessage({ serverContent: {} }), []);
    assert.deepEqual(parseServerMessage({ serverContent: { generationComplete: true } }), []);
    assert.deepEqual(parseServerMessage({ sessionResumptionUpdate: { newHandle: "a", resumable: true } }), []);
    assert.deepEqual(parseServerMessage({ toolCall: { functionCalls: [{ args: {} }] } }), []);
    assert.deepEqual(parseServerMessage(null), []);
  });

  it("reports goAway", () => {
    assert.deepEqual(parseServerMessage({ goAway: { timeLeft: "10s" } }), [{ type: "goAway" }]);
  });
});

describe("encodeBase64", () => {
  it("matches Node's encoder for every padding case", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 64, 1001]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString("base64"), `length ${length}`);
    }
  });
});

describe("decodeUtf8", () => {
  it("decodes French, Arabic and emoji the way TextDecoder does", () => {
    const text = `{"title":"Réunion à 18 h — اتصل بأمي غدًا 📞"}`;
    assert.equal(decodeUtf8(new TextEncoder().encode(text)), text);
  });
});

describe("toMonoPcm16", () => {
  it("passes mono through untouched", () => {
    const samples = Int16Array.from([1, -2, 3]);
    assert.deepEqual(new Int16Array(toMonoPcm16(samples.buffer, 1).buffer), samples);
  });

  it("averages interleaved stereo into one channel", () => {
    const stereo = Int16Array.from([100, 300, -100, -300, 32767, 32767]);
    assert.deepEqual(Array.from(new Int16Array(toMonoPcm16(stereo.buffer, 2).buffer)), [200, -200, 32767]);
  });
});

describe("audioLevel", () => {
  const pcm = (amplitude: number) =>
    new Uint8Array(Int16Array.from({ length: 160 }, (_, i) => (i % 2 === 0 ? amplitude : -amplitude)).buffer);

  it("is 0 for silence and a quiet room, 1 for a shout", () => {
    assert.equal(audioLevel(new Uint8Array(0)), 0);
    assert.equal(audioLevel(pcm(0)), 0);
    assert.equal(audioLevel(pcm(50)), 0); // ≈ -56 dBFS
    assert.equal(audioLevel(pcm(32767)), 1);
  });

  it("puts ordinary speech mid-range", () => {
    const speech = audioLevel(pcm(1800)); // ≈ -25 dBFS
    assert.ok(speech > 0.5 && speech < 0.75, `got ${speech}`);
  });
});
