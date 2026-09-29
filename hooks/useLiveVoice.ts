import { requestRecordingPermissionsAsync, useAudioStream } from "expo-audio";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";

import type { LiveSessionRequestBody, LiveSessionResponseBody } from "@/app/api/live-session+api";
import { describeNow, selectRelevantTasks, taskToContext } from "@/lib/ai/context";
import { apiPost } from "@/lib/api";
import { getLanguage } from "@/lib/i18n";
import { createLiveVoice } from "@/lib/liveVoice";
import { createLiveToolRunner } from "@/lib/liveVoiceTools";
import { beginRecording, endRecording } from "@/lib/recordingMode";
import { useTaskStore } from "@/store/useTaskStore";

// What Gemini Live reads natively — asking the microphone for it directly
// means nothing gets resampled on either end.
const SAMPLE_RATE = 16_000;
// Must match MAX_TASKS in app/api/live-session+api.ts. Open tasks first, by
// priority, then the most recently finished ("I didn't finish the report
// after all" needs to find it).
const MAX_TASKS = 80;

/**
 * Live voice for app/live-voice.tsx: the microphone, the socket and the task
 * tools wired into lib/liveVoice.ts, which does the actual work.
 */
export function useLiveVoice() {
  // How loud the microphone is, 0–1, for the sound waves. A shared value, not
  // state: it changes with every buffer, and only the waves need to move.
  const level = useSharedValue(0);

  const { stream } = useAudioStream({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    // Read through a ref inside expo-audio, and only ever called after this
    // render has finished — by which point `voice` exists.
    onBuffer: (buffer) => voice.sendAudio(buffer),
  });

  // Created once, like `stream` itself: expo-audio only replaces the stream
  // when its options change, and these are constants.
  const [voice] = useState(() => {
    // One per session: the ids the model was given ("t1" …) live in it.
    let runner = createLiveToolRunner(new Map());

    return createLiveVoice({
      requestPermission: async () => (await requestRecordingPermissionsAsync()).granted,
      requestSession: () => {
        const now = new Date();
        const tasks = selectRelevantTasks("", useTaskStore.getState().tasks, [], undefined, MAX_TASKS);
        // Short ids instead of real ones, as for /api/inbox: fewer tokens,
        // and an id the model makes up can't match a real task by accident.
        runner = createLiveToolRunner(new Map(tasks.map((task, index) => [`t${index + 1}`, task.id])));
        return apiPost<LiveSessionResponseBody>("/api/live-session", {
          tasks: tasks.map((task, index) => ({ ...taskToContext(task, now), id: `t${index + 1}` })),
          today: describeNow(now),
          language: getLanguage(),
        } satisfies LiveSessionRequestBody);
      },
      openSocket: (url) => new WebSocket(url),
      startMicrophone: async () => {
        await beginRecording("liveVoice");
        await stream.start();
      },
      stopMicrophone: () => {
        try {
          stream.stop();
        } catch {
          // Already stopped, or already released because the screen closed.
        }
        endRecording("liveVoice");
      },
      runTool: (call) => runner.run(call),
      undo: () => runner.undo(),
      undoCount: () => runner.undoCount(),
      onLevel: (value) => {
        // Eased between buffers, so the waves glide instead of twitching.
        level.value = withTiming(value, { duration: 120 });
      },
      log: __DEV__ ? (message) => console.log(`[liveVoice] ${message}`) : undefined,
    });
  });

  const state = useSyncExternalStore(voice.subscribe, voice.getState);

  // Leaving the screen ends the session; changes already made stay.
  useEffect(() => () => voice.dispose(), [voice]);

  // The phone stops handing over microphone audio in the background anyway —
  // better to stop cleanly than leave the socket waiting for more.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") voice.stop();
    });
    return () => subscription.remove();
  }, [voice]);

  return { ...state, level, start: voice.start, stop: voice.stop, undo: voice.undo };
}
