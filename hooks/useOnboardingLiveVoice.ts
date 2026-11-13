import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, useAudioStream } from "expo-audio";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";

import type { LiveSessionRequestBody, LiveSessionResponseBody } from "@/app/api/live-session+api";
import { describeNow } from "@/lib/ai/context";
import { markTrialUsed } from "@/lib/aiTrial";
import { apiPost } from "@/lib/api";
import { getLanguage } from "@/lib/i18n";
import { createLiveVoice } from "@/lib/liveVoice";
import { draftFromAddTask, sameTitle, type LiveToolCall, type LiveToolResult } from "@/lib/liveVoiceTools";
import { beginRecording, endRecording } from "@/lib/recordingMode";
import { useOnboardingStore } from "@/store/useOnboardingStore";

// What Gemini Live reads natively (as in hooks/useLiveVoice.ts).
const SAMPLE_RATE = 16_000;

/**
 * Adds what the model heard to the onboarding drafts — never to the task
 * list: before an account exists the tasks are only a preview, saved at
 * sign-up (hooks/useAuthSync.ts). Said twice, a task is replaced by the newer
 * version (it usually carries more detail) rather than listed twice.
 */
function runOnboardingTool(call: LiveToolCall): LiveToolResult {
  if (call.name !== "add_task") return { ok: false, error: "Only add_task is available during setup." };
  const draft = draftFromAddTask(call.args);
  if (!draft) return { ok: false, error: "A task needs a title." };
  const store = useOnboardingStore.getState();
  const index = store.drafts.findIndex((existing) => sameTitle(existing.title, draft.title));
  if (index >= 0) {
    const drafts = [...store.drafts];
    drafts[index] = { ...draft, candidateId: drafts[index].candidateId };
    store.setDrafts(drafts);
    return { ok: true, taskId: `t${index + 1}`, note: "Already on the list — updated it instead of adding a copy." };
  }
  const candidateId = `dump-${Date.now().toString(36)}-${store.drafts.length}`;
  store.setDrafts([...store.drafts, { ...draft, candidateId }]);
  return { ok: true, taskId: `t${store.drafts.length + 1}` };
}

/**
 * Live listening for onboarding's brain dump: the microphone streams to
 * Gemini Live and each task appears as soon as it has been said. Signed out,
 * the server allows one 60-second session per install
 * (app/api/live-session+api.ts).
 */
export function useOnboardingLiveVoice() {
  const level = useSharedValue(0);
  // Android's permission screen counts as the app going to the background
  // (see hooks/useLiveVoice.ts) — it mustn't end the session it's asking for.
  const [askingPermission] = useState(() => ({ current: false }));

  const { stream } = useAudioStream({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => voice.sendAudio(buffer),
  });

  const [voice] = useState(() =>
    createLiveVoice({
      // No mic button on 07 to start again after a pause: listen for the whole minute.
      stopOnSilence: false,
      requestPermission: async () => {
        if ((await getRecordingPermissionsAsync()).granted) return true;
        askingPermission.current = true;
        try {
          return (await requestRecordingPermissionsAsync()).granted;
        } finally {
          askingPermission.current = false;
        }
      },
      requestSession: async () => {
        const session = await apiPost<LiveSessionResponseBody>("/api/live-session", {
          tasks: [],
          today: describeNow(new Date()),
          language: getLanguage(),
        } satisfies LiveSessionRequestBody);
        // From here the install's free AI run is spent (lib/aiTrial.ts).
        void markTrialUsed();
        return session;
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
          // Already stopped, or released because the screen closed.
        }
        endRecording("liveVoice");
      },
      runTool: runOnboardingTool,
      undo: () => false,
      undoCount: () => 0,
      onLevel: (value) => {
        level.value = withTiming(value, { duration: 120 });
      },
      log: __DEV__ ? (message) => console.log(`[onboardingVoice] ${message}`) : undefined,
    }),
  );

  const state = useSyncExternalStore(voice.subscribe, voice.getState);

  useEffect(() => () => voice.dispose(), [voice]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" && !askingPermission.current) voice.stop();
    });
    return () => subscription.remove();
  }, [askingPermission, voice]);

  return { ...state, level, start: voice.start, stop: voice.stop };
}
