import type { LiveSessionResponseBody } from "@/app/api/live-session+api";
import { audioLevel, decodeUtf8, encodeBase64, parseServerMessage, toMonoPcm16, type LiveEvent } from "@/lib/liveProtocol";
import type { LiveToolCall, LiveToolResult } from "@/lib/liveVoiceTools";

// One live voice session, start to finish: open a socket to Gemini Live,
// stream the microphone into it, and carry out every tool call it makes the
// moment it arrives — while the user keeps talking. Plain JS with everything
// native passed in (hooks/useLiveVoice.ts supplies the real microphone,
// socket and task tools), so tests/liveVoice.test.ts can drive it with
// stand-ins.

/** Live voice stops on its own after this. The server's token dies a minute later (app/api/live-session+api.ts). */
export const MAX_LIVE_SECONDS = 5 * 60;
/**
 * Nobody has spoken for this long: stop, rather than keep paying for the
 * microphone streaming silence. Counted from when listening began or Google
 * heard the last sentence end — never while someone is talking.
 */
export const SILENCE_STOP_SECONDS = 4;
/** After Stop, the longest to wait for Google to act on the last sentence. */
const LAST_TURN_WAIT_MS = 3000;
/** WebSocket.OPEN — a number here so the test stand-in doesn't need the class. */
const SOCKET_OPEN = 1;

export type LiveVoiceStatus = "idle" | "connecting" | "listening" | "finishing" | "stopped" | "error";
export type LiveVoiceProblem = "permission" | "unavailable" | "connection" | "timeLimit" | "silence";

export type LiveVoiceState = {
  status: LiveVoiceStatus;
  problem: LiveVoiceProblem | null;
  /** When listening began (ms since epoch), for the clock. */
  startedAt: number | null;
  /** Changes made this session so far. */
  changes: number;
  /** How many of them Undo can still reverse. */
  undoable: number;
};

export type LiveAudioBuffer = { data: ArrayBuffer; sampleRate: number; channels: number };

export type LiveVoiceDeps = {
  requestPermission: () => Promise<boolean>;
  /** A fresh single-use token and setup from /api/live-session. */
  requestSession: () => Promise<LiveSessionResponseBody>;
  openSocket: (url: string) => WebSocket;
  startMicrophone: () => Promise<void>;
  /** Safe to call when the microphone isn't running. */
  stopMicrophone: () => void;
  /** Carries out one tool call on the task list (lib/liveVoiceTools.ts). */
  runTool: (call: LiveToolCall) => LiveToolResult;
  undo: () => boolean;
  undoCount: () => number;
  /** How loud the microphone is (0–1) with every buffer sent, then 0 once it stops — for the sound waves. */
  onLevel?: (level: number) => void;
  /** Development only: what was heard and done, for checking it in the terminal. */
  log?: (message: string) => void;
};

export type LiveVoice = ReturnType<typeof createLiveVoice>;

const INITIAL_STATE: LiveVoiceState = { status: "idle", problem: null, startedAt: null, changes: 0, undoable: 0 };

export function createLiveVoice(deps: LiveVoiceDeps) {
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  const setState = (patch: Partial<LiveVoiceState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  // Bumped whenever a session starts or ends. Every callback checks it, so a
  // late message from a session that's already over changes nothing.
  let session = 0;
  let socket: WebSocket | null = null;
  let streaming = false;
  // Google heard speech it hasn't finished acting on yet (ACTIVITY_START
  // without a turnComplete after it) — what Stop has to wait for.
  let turnOpen = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;

  const closeSocket = () => {
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    try {
      current.close();
    } catch {
      // Already closed.
    }
  };

  const end = (status: "stopped" | "error", problem: LiveVoiceProblem | null) => {
    session += 1;
    clearTimeout(finishTimer);
    clearTimeout(limitTimer);
    clearTimeout(silenceTimer);
    streaming = false;
    turnOpen = false;
    deps.stopMicrophone();
    deps.onLevel?.(0);
    closeSocket();
    setState({ status, problem, startedAt: null });
  };

  const stop = (problem: LiveVoiceProblem | null = null) => {
    if (state.status === "connecting") {
      end("stopped", problem);
      return;
    }
    if (state.status !== "listening") return;
    streaming = false;
    deps.stopMicrophone();
    deps.onLevel?.(0);
    clearTimeout(limitTimer);
    clearTimeout(silenceTimer);
    // Everything said has been acted on: nothing to wait for.
    if (!turnOpen || socket?.readyState !== SOCKET_OPEN) {
      end("stopped", problem);
      return;
    }
    // Mid-sentence: tell Google the audio is over, so it acts on what it has
    // now instead of waiting for a pause that won't come.
    const current = session;
    socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    setState({ status: "finishing", problem });
    finishTimer = setTimeout(() => {
      if (current === session) end("stopped", problem);
    }, LAST_TURN_WAIT_MS);
  };

  // (Re)starts the silence countdown; speech starting cancels it.
  const waitForSpeech = () => {
    clearTimeout(silenceTimer);
    if (state.status !== "listening") return;
    const current = session;
    silenceTimer = setTimeout(() => {
      if (current === session) stop("silence");
    }, SILENCE_STOP_SECONDS * 1000);
  };

  const beginListening = async (current: number) => {
    try {
      await deps.startMicrophone();
    } catch (error) {
      console.warn("[liveVoice] microphone didn't start", error);
      if (current === session) end("error", "unavailable");
      return;
    }
    if (current !== session) {
      deps.stopMicrophone(); // the session ended while the microphone was starting
      return;
    }
    streaming = true;
    setState({ status: "listening", startedAt: Date.now() });
    limitTimer = setTimeout(() => {
      if (current === session) stop("timeLimit");
    }, MAX_LIVE_SECONDS * 1000);
    waitForSpeech();
  };

  const runTools = (calls: LiveToolCall[]) => {
    const functionResponses = calls.map((call) => {
      const result = deps.runTool(call);
      deps.log?.(`${call.name}(${JSON.stringify(call.args)}) → ${JSON.stringify(result)}`);
      // SILENT, on the response and inside it: without it Gemini Live took
      // each answer as a cue for another turn and made the same call again
      // (checked 2026-09-29). With it, it just goes back to listening.
      return { id: call.id, name: call.name, scheduling: "SILENT", response: { ...result, scheduling: "SILENT" } };
    });
    if (socket?.readyState === SOCKET_OPEN) socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
    const done = functionResponses.filter((entry) => entry.response.ok).length;
    setState({ changes: state.changes + done, undoable: deps.undoCount() });
  };

  const handleEvent = (event: LiveEvent) => {
    switch (event.type) {
      case "ready":
        if (state.status === "connecting") void beginListening(session);
        return;
      case "speechStart":
        turnOpen = true;
        clearTimeout(silenceTimer);
        return;
      case "speechEnd":
        waitForSpeech();
        return;
      case "toolCalls":
        runTools(event.calls);
        return;
      case "turnComplete":
        turnOpen = false;
        if (state.status === "finishing") end("stopped", state.problem);
        else waitForSpeech();
        return;
      case "goAway":
        stop();
        return;
      case "transcript":
        deps.log?.(`heard: "${event.text}"`);
        return;
      case "usage":
        deps.log?.(`turn: ${event.promptTokens} in, ${event.responseTokens} out, ${event.thoughtsTokens} thinking`);
        return;
    }
  };

  const handleMessage = (current: number, data: unknown) => {
    let message: unknown;
    try {
      const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? decodeUtf8(new Uint8Array(data)) : "";
      message = JSON.parse(text);
    } catch {
      return;
    }
    for (const event of parseServerMessage(message)) {
      if (current !== session) return;
      handleEvent(event);
    }
  };

  const start = async () => {
    if (state.status === "connecting" || state.status === "listening" || state.status === "finishing") return;
    session += 1;
    const current = session;
    turnOpen = false;
    setState({ status: "connecting", problem: null, startedAt: null, changes: 0, undoable: 0 });

    const granted = await deps.requestPermission();
    if (current !== session) return;
    if (!granted) {
      end("error", "permission");
      return;
    }

    let live: LiveSessionResponseBody;
    try {
      live = await deps.requestSession();
    } catch (error) {
      console.warn("[liveVoice] couldn't start a session", error);
      if (current === session) end("error", "unavailable");
      return;
    }
    if (current !== session) return;

    const opened = deps.openSocket(live.url);
    // Google sends its JSON as binary frames; React Native would otherwise
    // hand them over as Blobs, which can't be read synchronously.
    opened.binaryType = "arraybuffer";
    socket = opened;
    opened.onopen = () => opened.send(JSON.stringify(live.setup));
    opened.onmessage = (event) => {
      if (current === session) handleMessage(current, event.data);
    };
    opened.onclose = (event) => {
      if (current !== session) return;
      deps.log?.(`socket closed: ${event.code} ${event.reason}`);
      if (state.status === "finishing") end("stopped", state.problem);
      // Closed before listening began: the token or setup was turned away.
      else end("error", state.status === "connecting" ? "unavailable" : "connection");
    };
  };

  return {
    start,
    stop: () => stop(),
    /** The Undo button: the latest change this session, as "undo" said out loud. */
    undo: () => {
      if (deps.undo()) setState({ undoable: deps.undoCount() });
    },
    /** Every microphone buffer lands here; only sent while listening. */
    sendAudio: (buffer: LiveAudioBuffer) => {
      if (!streaming || !socket || socket.readyState !== SOCKET_OPEN) return;
      const pcm = toMonoPcm16(buffer.data, buffer.channels);
      deps.onLevel?.(audioLevel(pcm));
      socket.send(
        JSON.stringify({
          realtimeInput: { audio: { data: encodeBase64(pcm), mimeType: `audio/pcm;rate=${buffer.sampleRate}` } },
        }),
      );
    },
    /** The screen is going away: end any session. Changes already made stay. */
    dispose: () => {
      if (state.status === "connecting" || state.status === "listening" || state.status === "finishing") {
        end("stopped", null);
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
  };
}
