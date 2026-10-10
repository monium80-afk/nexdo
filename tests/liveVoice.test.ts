/// <reference types="node" />
// A live voice session driven end to end with stand-ins for the microphone,
// the socket and the task tools: what goes out on the socket, that every tool
// call is carried out and answered silently, and how Stop, a dropped
// connection and a refused microphone end things.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { LiveSessionResponseBody } from "@/app/api/live-session+api";
import { createLiveVoice, MAX_LIVE_SECONDS, SILENCE_STOP_SECONDS, type LiveVoiceDeps } from "@/lib/liveVoice";
import type { LiveToolCall } from "@/lib/liveVoiceTools";
import { PlanLimitError } from "@/lib/plan";

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

class FakeSocket {
  readonly url: string;
  readyState = 1;
  binaryType = "blob";
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  /** A server message, as Google sends it: JSON in a binary frame. */
  receive(message: unknown) {
    this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(message)).buffer });
  }

  dropConnection() {
    this.readyState = 3;
    this.onclose?.({ code: 1011, reason: "Internal error" });
  }
}

const SESSION: LiveSessionResponseBody = {
  url: "wss://example.test/live?access_token=auth_tokens/abc",
  setup: { setup: { model: "models/gemini-3.8-live" } },
  sessionId: "3f2b9c1e-5d4a-4b8e-9a7c-1e2d3f4a5b6c",
};

function toolCall(...calls: { name: string; args?: Record<string, unknown>; id?: string }[]) {
  return { toolCall: { functionCalls: calls.map((call, index) => ({ id: call.id ?? `call_${index}`, name: call.name, args: call.args ?? {} })) } };
}

const speechStart = { voiceActivity: { type: "ACTIVITY_START", audioOffset: "0.9s" } };
const speechEnd = { voiceActivity: { type: "ACTIVITY_END", audioOffset: "3.2s" } };
const turnComplete = { serverContent: { turnComplete: true } };

function setup(overrides: Partial<LiveVoiceDeps> = {}) {
  const sockets: FakeSocket[] = [];
  const calls: LiveToolCall[] = [];
  const microphone = { running: false, starts: 0 };
  let undoable = 0;
  const voice = createLiveVoice({
    requestPermission: async () => true,
    requestSession: async () => SESSION,
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    startMicrophone: async () => {
      microphone.running = true;
      microphone.starts += 1;
    },
    stopMicrophone: () => {
      microphone.running = false;
    },
    runTool: (call) => {
      calls.push(call);
      if (call.name === "delete_task" && call.args.taskId === "t99") return { ok: false, error: "No task with that id — nothing changed." };
      undoable += 1;
      return { ok: true, taskId: call.name === "add_task" ? "t4" : String(call.args.taskId) };
    },
    undo: () => {
      if (undoable === 0) return false;
      undoable -= 1;
      return true;
    },
    undoCount: () => undoable,
    ...overrides,
  });
  return { voice, sockets, calls, microphone };
}

/** Started, set up, and listening. */
async function listening(overrides: Partial<LiveVoiceDeps> = {}) {
  const context = setup(overrides);
  await context.voice.start();
  const socket = context.sockets[0];
  socket.onopen?.();
  socket.receive({ setupComplete: {} });
  await flush();
  return { ...context, socket };
}

const audio = () => ({ data: Int16Array.from([1, 2, 3, 4]).buffer, sampleRate: 16000, channels: 1 });

describe("live voice session", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("sends the setup, then only streams audio once Google is ready", async () => {
    const { voice, sockets, microphone } = setup();
    await voice.start();
    const socket = sockets[0];
    assert.equal(socket.url, SESSION.url);
    assert.equal(socket.binaryType, "arraybuffer");
    assert.equal(voice.getState().status, "connecting");

    socket.onopen?.();
    assert.deepEqual(socket.sent, [SESSION.setup]);

    voice.sendAudio(audio());
    assert.equal(socket.sent.length, 1, "no audio before setupComplete");
    assert.equal(microphone.running, false);

    socket.receive({ setupComplete: {} });
    await flush();
    assert.equal(voice.getState().status, "listening");
    assert.equal(microphone.running, true);

    voice.sendAudio(audio());
    assert.deepEqual(socket.sent[1], {
      realtimeInput: { audio: { data: Buffer.from(Int16Array.from([1, 2, 3, 4]).buffer).toString("base64"), mimeType: "audio/pcm;rate=16000" } },
    });
  });

  it("carries out each tool call the moment it arrives and answers it silently", async () => {
    const { voice, socket, calls } = await listening();
    socket.receive(speechStart);
    socket.receive(toolCall({ id: "call_1", name: "add_task", args: { title: "Call mom", dueDatePhrase: "tomorrow at 6 pm" } }));

    assert.deepEqual(calls, [{ id: "call_1", name: "add_task", args: { title: "Call mom", dueDatePhrase: "tomorrow at 6 pm" } }]);
    assert.deepEqual(socket.sent.at(-1), {
      toolResponse: {
        functionResponses: [
          { id: "call_1", name: "add_task", scheduling: "SILENT", response: { ok: true, taskId: "t4", scheduling: "SILENT" } },
        ],
      },
    });
    assert.equal(voice.getState().changes, 1);
    assert.equal(voice.getState().undoable, 1);
  });

  it("answers every call in a batch, and doesn't count one that changed nothing", async () => {
    const { voice, socket } = await listening();
    socket.receive(toolCall({ name: "complete_task", args: { taskId: "t2" } }, { name: "delete_task", args: { taskId: "t99" } }));
    const responses = (socket.sent.at(-1) as { toolResponse: { functionResponses: { response: { ok: boolean } }[] } }).toolResponse
      .functionResponses;
    assert.deepEqual(
      responses.map((entry) => entry.response.ok),
      [true, false],
    );
    assert.equal(voice.getState().changes, 1);
  });

  it("reads Google's own message sequence for one instruction", async () => {
    // Recorded from gemini-3.8-live on 2026-09-29.
    const { socket, calls } = await listening();
    socket.receive({ sessionResumptionUpdate: { newHandle: "abc", resumable: true } });
    socket.receive(speechStart);
    socket.receive({ serverContent: { inputTranscription: { text: "Delete the gym task." } } });
    socket.receive({ voiceActivity: { type: "ACTIVITY_END", audioOffset: "10.920s" } });
    socket.receive({});
    socket.receive({ serverContent: {} });
    socket.receive({ toolCall: { functionCalls: [{ name: "delete_task", args: { taskId: "t1" }, id: "call_947389" }] } });
    socket.receive({ serverContent: { generationComplete: true } });
    socket.receive({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 3025, responseTokenCount: 13 } });
    assert.deepEqual(calls, [{ id: "call_947389", name: "delete_task", args: { taskId: "t1" } }]);
  });

  it("on Stop with everything already acted on, ends at once", async () => {
    const { voice, socket, microphone } = await listening();
    socket.receive(speechStart);
    socket.receive(toolCall({ name: "add_task", args: { title: "Buy milk" } }));
    socket.receive(turnComplete);
    voice.stop();
    assert.equal(voice.getState().status, "stopped");
    assert.equal(socket.closed, true);
    assert.equal(microphone.running, false);
    assert.ok(!socket.sent.some((message) => "realtimeInput" in message && JSON.stringify(message).includes("audioStreamEnd")));
  });

  it("on Stop mid-sentence, ends the audio and still acts on what was said", async () => {
    const { voice, socket, calls, microphone } = await listening();
    socket.receive(speechStart);
    voice.stop();
    assert.equal(voice.getState().status, "finishing");
    assert.equal(microphone.running, false);
    assert.deepEqual(socket.sent.at(-1), { realtimeInput: { audioStreamEnd: true } });

    socket.receive(toolCall({ name: "delete_task", args: { taskId: "t1" } }));
    assert.equal(calls.length, 1, "a call that arrives while finishing is still carried out");
    socket.receive(turnComplete);
    assert.equal(voice.getState().status, "stopped");
    assert.equal(socket.closed, true);
  });

  it("doesn't wait forever for a last turn that never comes", async () => {
    const { voice, socket } = await listening();
    socket.receive(speechStart);
    voice.stop();
    mock.timers.tick(3000);
    assert.equal(voice.getState().status, "stopped");
  });

  it("undoes from the button", async () => {
    const { voice, socket } = await listening();
    socket.receive(toolCall({ name: "add_task", args: { title: "Buy milk" } }));
    assert.equal(voice.getState().undoable, 1);
    voice.undo();
    assert.equal(voice.getState().undoable, 0);
    voice.undo();
    assert.equal(voice.getState().undoable, 0);
  });

  it("reports a dropped connection, keeping the changes already made", async () => {
    const { voice, socket, microphone } = await listening();
    socket.receive(toolCall({ name: "add_task", args: { title: "Buy milk" } }));
    socket.dropConnection();
    assert.equal(voice.getState().status, "error");
    assert.equal(voice.getState().problem, "connection");
    assert.equal(voice.getState().changes, 1);
    assert.equal(microphone.running, false);
  });

  it("reports a socket closed before setup as unavailable", async () => {
    const { voice, sockets } = setup();
    await voice.start();
    sockets[0].dropConnection();
    assert.equal(voice.getState().problem, "unavailable");
  });

  it("stops at the time limit", async () => {
    const { voice, socket } = await listening();
    // An instruction more often than the silence stop, so only the time limit can end it.
    const step = (SILENCE_STOP_SECONDS - 1) * 1000;
    for (let elapsed = 0; elapsed < MAX_LIVE_SECONDS * 1000; elapsed += step) {
      mock.timers.tick(step);
      if (voice.getState().status !== "listening") break;
      socket.receive(speechStart);
      socket.receive(turnComplete);
    }
    assert.equal(voice.getState().status, "stopped");
    assert.equal(voice.getState().problem, "timeLimit");
  });

  it("stops when nobody speaks after it starts listening", async () => {
    const { voice, socket, microphone } = await listening();
    mock.timers.tick(SILENCE_STOP_SECONDS * 1000 - 1);
    assert.equal(voice.getState().status, "listening");
    mock.timers.tick(1);
    assert.equal(voice.getState().status, "stopped");
    assert.equal(voice.getState().problem, "silence");
    assert.equal(microphone.running, false);
    assert.equal(socket.closed, true);
  });

  it("never stops for silence while someone is talking, and counts it from when they stop", async () => {
    const { voice, socket } = await listening();
    mock.timers.tick(SILENCE_STOP_SECONDS * 1000 - 1000);
    socket.receive(speechStart);
    mock.timers.tick(SILENCE_STOP_SECONDS * 2000);
    assert.equal(voice.getState().status, "listening", "a long sentence isn't silence");

    socket.receive(speechEnd);
    socket.receive(toolCall({ name: "add_task", args: { title: "Buy milk" } }));
    mock.timers.tick(500);
    socket.receive(turnComplete);
    mock.timers.tick(SILENCE_STOP_SECONDS * 1000 - 1);
    assert.equal(voice.getState().status, "listening");
    mock.timers.tick(1);
    assert.equal(voice.getState().problem, "silence");
    assert.equal(voice.getState().changes, 1);
  });

  it("reports how loud the microphone is, then 0 once it stops", async () => {
    const levels: number[] = [];
    const { voice } = await listening({ onLevel: (level) => levels.push(level) });
    voice.sendAudio({ data: Int16Array.from({ length: 160 }, (_, i) => (i % 2 ? 1800 : -1800)).buffer, sampleRate: 16000, channels: 1 });
    assert.ok(levels[0] > 0.5, `got ${levels[0]}`);
    voice.stop();
    assert.equal(levels.at(-1), 0);
  });

  it("doesn't open anything without the microphone", async () => {
    const { voice, sockets } = setup({ requestPermission: async () => false });
    await voice.start();
    assert.equal(voice.getState().status, "error");
    assert.equal(voice.getState().problem, "permission");
    assert.equal(sockets.length, 0);
  });

  it("reports a failed token request as unavailable", async () => {
    const { voice, sockets } = setup({
      requestSession: async () => {
        throw new Error("/api/live-session failed: 502");
      },
    });
    await voice.start();
    assert.equal(voice.getState().problem, "unavailable");
    assert.equal(sockets.length, 0);
  });

  it("says so when Live voice isn't in the plan, or the month's minutes are used up", async () => {
    const { voice, sockets } = setup({
      requestSession: async () => {
        throw new PlanLimitError("live", "free");
      },
    });
    await voice.start();
    assert.equal(voice.getState().status, "error");
    assert.equal(voice.getState().problem, "planLimit");
    assert.equal(sockets.length, 0);
  });

  it("stops when what's left of the month's minutes runs out", async () => {
    const maxSeconds = SILENCE_STOP_SECONDS * 3;
    const { voice, socket } = await listening({ requestSession: async () => ({ ...SESSION, maxSeconds }) });
    // An instruction more often than the silence stop, so only the limit can end it.
    const step = (SILENCE_STOP_SECONDS - 1) * 1000;
    for (let elapsed = 0; elapsed < maxSeconds * 1000; elapsed += step) {
      mock.timers.tick(step);
      if (voice.getState().status !== "listening") break;
      socket.receive(speechStart);
      socket.receive(turnComplete);
    }
    assert.equal(voice.getState().status, "stopped");
    assert.equal(voice.getState().problem, "planLimit");
  });

  it("reports how long it listened, once per session, with the session's id", async () => {
    const listened: [number, string | undefined][] = [];
    const { voice, sockets } = await listening({ onListened: (seconds, sessionId) => listened.push([seconds, sessionId]) });
    assert.deepEqual(listened, [], "nothing to report while it's still listening");
    voice.stop();
    voice.dispose();
    assert.equal(listened.length, 1);
    assert.ok(listened[0][0] >= 0);
    assert.equal(listened[0][1], SESSION.sessionId);

    // A second session on the same screen is reported separately.
    await voice.start();
    sockets[1].onopen?.();
    sockets[1].receive({ setupComplete: {} });
    await flush();
    sockets[1].dropConnection();
    assert.equal(listened.length, 2, "a dropped connection still counts what was used");
  });

  it("reports 0 for a session that never got to listen, so its time is given back", async () => {
    const listened: [number, string | undefined][] = [];
    const { voice, sockets } = setup({ onListened: (seconds, sessionId) => listened.push([seconds, sessionId]) });
    await voice.start();
    sockets[0].dropConnection();
    assert.deepEqual(listened, [[0, SESSION.sessionId]]);
  });

  it("reports 0 for a session stopped while the server was still opening it", async () => {
    const listened: [number, string | undefined][] = [];
    let open: (session: LiveSessionResponseBody) => void = () => {};
    const { voice, sockets } = setup({
      requestSession: () => new Promise((resolve) => (open = resolve)),
      onListened: (seconds, sessionId) => listened.push([seconds, sessionId]),
    });
    const starting = voice.start();
    await flush();
    voice.stop();
    open(SESSION);
    await starting;
    assert.deepEqual(listened, [[0, SESSION.sessionId]]);
    assert.equal(sockets.length, 0);
  });

  it("ignores a late tool call from a session that's already over", async () => {
    const { voice, socket, calls } = await listening();
    voice.dispose();
    assert.equal(voice.getState().status, "stopped");
    socket.onmessage?.({ data: JSON.stringify(toolCall({ name: "delete_task", args: { taskId: "t1" } })) });
    assert.deepEqual(calls, []);
  });

  it("can talk again after stopping", async () => {
    const { voice, sockets, microphone } = await listening();
    voice.stop();
    await voice.start();
    assert.equal(sockets.length, 2);
    sockets[1].onopen?.();
    sockets[1].receive({ setupComplete: {} });
    await flush();
    assert.equal(voice.getState().status, "listening");
    assert.equal(voice.getState().changes, 0);
    assert.equal(microphone.starts, 2);
  });
});
