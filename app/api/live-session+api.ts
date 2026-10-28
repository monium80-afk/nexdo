import { LIVE_VOICE_SYSTEM_PROMPT } from "@/data/liveVoicePrompt";
import type { TaskContext } from "@/lib/ai/context";
import { createLiveSessionToken } from "@/lib/ai/gemini";
import { languageName } from "@/lib/ai/language";
import { claimUserCall } from "@/lib/aiUsageLimit";
import { MAX_LIVE_SECONDS } from "@/lib/liveVoice";
import { authenticate, unauthorized } from "@/lib/serverAuth";
import { settleLiveSession, startLiveSession } from "@/lib/serverPlan";
import {
    asObject,
    badRequest,
    BadRequestError,
    clampArray,
    clampString,
    LANGUAGES,
    oneOf,
    parseTaskContext,
    readJsonBody,
} from "@/lib/serverRequest";
import type { AppLanguage } from "@/types/settings";

// Live voice (app/live-voice.tsx): the phone streams the microphone straight
// to Gemini Live, which changes tasks by calling the tools below while the
// user is still talking — the app carries each call out on the phone
// (lib/liveVoiceTools.ts). This route only opens the door: it hands out a
// single-use token locked to the session set up here, task list included.

export type LiveSessionRequestBody = {
  /** The user's tasks, ids already swapped for aliases ("t1", "t2", …) as for /api/inbox. */
  tasks: TaskContext[];
  /** "Now" in the user's own words and time zone (describeNow). */
  today: string;
  language?: AppLanguage;
};

export type LiveSessionResponseBody = {
  /** The WebSocket to open — the token is part of it. */
  url: string;
  /** The first message to send once it's open. */
  setup: { setup: Record<string, unknown> };
  /**
   * How long this session may listen: the app's own limit, or what is left
   * of the month's Live voice minutes if that is less.
   */
  maxSeconds?: number;
  /**
   * The session's time is taken from the month's allowance up front; sent
   * back with /api/live-usage once it's over, so what it didn't use is given
   * back.
   */
  sessionId?: string;
};

// The low-latency Live model — the "extended thinking" one reasons in the
// background first, which is the opposite of what this is for. Audio in is
// ≈$0.005/min; text in $0.75/M tokens; text out $4.50/M (Google, 2026-09).
const LIVE_MODEL = "models/gemini-3.8-live";

// The app stops listening once the session's time is up (lib/liveVoice.ts);
// the token dies a minute after that — time to connect, and for Google to act
// on the last sentence — so a client that ignored the limit still can't keep
// a session running on this key.
const TOKEN_GRACE_SECONDS = 60;

const MAX_BODY_BYTES = 256 * 1024;
// More than /api/inbox's 30: a live session can't ask for a different slice
// halfway through, so it gets the whole open list up front.
const MAX_TASKS = 80;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const TASK_ID = { type: "STRING", description: "The task's id from the list, or from an earlier tool result (e.g. t3)." };

const REPEAT = {
  type: "OBJECT",
  description: 'Only when the user says it repeats ("every Monday", "daily"), or stops repeating (frequency "none").',
  properties: {
    frequency: { type: "STRING", enum: ["daily", "weekly", "monthly", "yearly", "none"] },
    interval: { type: "NUMBER", description: "Every N days/weeks/… — 2 for every other week. Omit for 1." },
    weekdays: { type: "ARRAY", items: { type: "STRING", enum: WEEKDAYS }, description: "Weekly only: which days." },
    monthDay: { type: "NUMBER", description: "Monthly only: day of the month." },
    endDatePhrase: { type: "STRING", description: 'When it stops, in English ("end of december").' },
  },
  required: ["frequency"],
};

const DETAILS = {
  dueDatePhrase: {
    type: "STRING",
    description: 'The deadline as the user said it, translated to English ("tomorrow at 6 pm", "next friday"). Never a computed date.',
  },
  priority: {
    type: "STRING",
    enum: ["critical", "high", "medium", "low"],
    description:
      'Only if the user said how important it is. "critical" only when they stressed it ("really important", "top priority", "critical").',
  },
  repeat: REPEAT,
};

const SCOPE = {
  type: "STRING",
  enum: ["this", "future", "series"],
  description: 'For a repeating task: just this occurrence (default), this and later ones ("from now on"), or all of them.',
};

// Declared in Gemini's OpenAPI subset, like the inbox's response schema. The
// argument names match /api/inbox's action fields, so the app turns a call
// into the same operation a typed message would make.
//
// NON_BLOCKING, with every answer sent back as SILENT (lib/liveVoice.ts): as
// plain blocking functions, Gemini Live took each answer as a cue for another
// turn and made the very same call again — every add, delete and complete
// happened twice (checked 2026-09-29).
const FUNCTIONS = [
      {
        name: "add_task",
        description: "Add a new task to the list.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Short task name in the user's language, without the date or time words." },
            // Required: left out, the app could only guess from keywords, and
            // "brush my teeth" came out at 30 minutes.
            estimatedMinutes: {
              type: "NUMBER",
              description:
                "How long the task takes, in minutes: what the user said, or else your realistic estimate (brushing teeth 3, a quick call 10, an essay 120). 0 for a goal kept up through the day rather than one sitting of work (drink 2 L of water, 10,000 steps, no sugar today).",
            },
            ...DETAILS,
          },
          required: ["title", "estimatedMinutes"],
        },
      },
      {
        name: "update_task",
        description: "Change an existing task: rename it, move its deadline, change its length, importance or how it repeats.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskId: TASK_ID,
            title: { type: "STRING", description: "The new name, only when renaming." },
            estimatedMinutes: { type: "NUMBER", description: "The new length in minutes, only when the user changes it." },
            ...DETAILS,
            dueDateShift: {
              type: "OBJECT",
              description: 'Move the deadline by an amount ("two days later" → 2 days; "an hour earlier" → -1 hours).',
              properties: {
                amount: { type: "NUMBER" },
                unit: { type: "STRING", enum: ["minutes", "hours", "days", "weeks", "months"] },
              },
              required: ["amount", "unit"],
            },
            scope: SCOPE,
          },
          required: ["taskId"],
        },
      },
      {
        name: "complete_task",
        description: "Mark a task as done.",
        parameters: { type: "OBJECT", properties: { taskId: TASK_ID }, required: ["taskId"] },
      },
      {
        name: "reopen_task",
        description: "Mark a completed task as not done again.",
        parameters: { type: "OBJECT", properties: { taskId: TASK_ID }, required: ["taskId"] },
      },
      {
        name: "delete_task",
        description: "Delete a task.",
        parameters: { type: "OBJECT", properties: { taskId: TASK_ID, scope: SCOPE }, required: ["taskId"] },
      },
      {
        name: "add_note",
        description: "Save something the user said about a task: why, who, where, what's blocking it, how big it really is.",
        parameters: {
          type: "OBJECT",
          properties: { taskId: TASK_ID, note: { type: "STRING", description: "In the user's own words." } },
          required: ["taskId", "note"],
        },
      },
      {
        name: "undo_last_change",
        description: "Reverse the most recent change, when the user says undo or that it was wrong.",
        parameters: { type: "OBJECT", properties: {} },
      },
];

const TOOLS = [{ functionDeclarations: FUNCTIONS.map((declaration) => ({ ...declaration, behavior: "NON_BLOCKING" })) }];

/** One line per task: "t3 | Call the bank | open, Due tomorrow at 6:00 PM, 30 min, high priority". */
function taskLine(task: TaskContext): string {
  const details = [
    task.status === "completed" ? (task.completedLabel ?? "completed") : task.overdue ? "open, OVERDUE" : "open",
    task.status === "completed" ? undefined : task.dueLabel || undefined,
    task.estimatedMinutes > 0 ? `${task.estimatedMinutes} min` : "no duration",
    task.priority ? `${task.priority} priority` : undefined,
    task.repeats ? `repeats ${task.repeats}` : undefined,
  ].filter(Boolean);
  return `${task.id} | ${task.title} | ${details.join(", ")}`;
}

/** The session every token is locked to. Exported so a live check can open the very same session without Clerk. */
export function liveSetup(body: LiveSessionRequestBody): Record<string, unknown> {
  const language = body.language && body.language !== "en" ? languageName(body.language) : null;
  const instruction = [
    LIVE_VOICE_SYSTEM_PROMPT,
    language
      ? `LANGUAGE\nThe app is set to ${language}: write titles and notes in ${language}, unless the user is clearly speaking another language — then use theirs. dueDatePhrase is still always English.`
      : "",
    `NOW\n${body.today}`,
    `TASKS\n${body.tasks.length > 0 ? body.tasks.map(taskLine).join("\n") : "(none yet)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    model: LIVE_MODEL,
    // The app only wants tool calls, but this model refuses a text-only
    // session (1007 "response modalities (TEXT) is not supported", checked
    // 2026-09-29). The prompt keeps it silent; any audio it does send is
    // never played.
    //
    // No thinking: it answers 0.05–0.3 s after the end of a sentence instead
    // of up to half a second, which is what lets it act on a sentence before
    // the next one starts — with thinking on, a quick follow-up got merged
    // into the same turn and the first instruction waited 3 s for it. Tool
    // choices were just as right without it on the test clips (2026-09-29).
    // (thinkingLevel is refused by this model; thinkingBudget works.)
    generationConfig: { responseModalities: ["AUDIO"], temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    systemInstruction: { parts: [{ text: instruction }] },
    tools: TOOLS,
    realtimeInputConfig: {
      // A short pause is enough to end a turn, so each instruction is acted
      // on as soon as the user draws breath rather than when they stop. This
      // wait is most of the delay before a change appears; it was 400 ms until
      // the user asked for faster adds. Much shorter and a mid-sentence
      // hesitation would split one instruction in two.
      automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_HIGH", silenceDurationMs: 250 },
      // Talking on doesn't cancel the model's work on the sentence before.
      // By default it does: "the bank call is urgent" followed quickly by the
      // next sentence was only acted on 3 s later, with that one (2026-09-29).
      activityHandling: "NO_INTERRUPTION",
    },
  };
}

export function parseBody(raw: unknown): LiveSessionRequestBody {
  const body = asObject(raw);
  return {
    tasks: clampArray(body.tasks, MAX_TASKS)
      .map(parseTaskContext)
      .filter((task): task is TaskContext => task !== null),
    today: clampString(body.today, 80) ?? new Date().toUTCString(),
    language: oneOf(body.language, LANGUAGES),
  };
}

// Signed-in only. The one AI run a signed-out install gets (onboarding) never
// streams audio, and a live session is billed by the minute. It is also part
// of Pro only (lib/plan.ts), counted in minutes of listening: this route
// takes the session's time from the month up front, and the app reports what
// it really used once it's over (app/api/live-usage+api.ts), which gives the
// rest back.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) return unauthorized();

  let raw: unknown;
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BadRequestError) return badRequest();
    throw error;
  }

  // The plan first: a Free account (no Magic mic at all) or one out of
  // minutes is turned away without using up one of the day's sessions.
  const session = await startLiveSession(request, auth.userId, MAX_LIVE_SECONDS);
  if ("refused" in session) return session.refused;

  // The stop behind the app's reports: a tampered app could say a session
  // used nothing, but it can only open so many a day. Over that, the time
  // just taken goes back.
  const limitResponse = await claimUserCall(auth.userId, "live-session");
  if (limitResponse) {
    await settleLiveSession(auth.userId, session.sessionId, 0);
    return limitResponse;
  }

  const setup = liveSetup(parseBody(raw));
  try {
    const { websocketUrl } = await createLiveSessionToken({
      setup,
      sessionSeconds: session.seconds + TOKEN_GRACE_SECONDS,
    });
    return Response.json({
      url: websocketUrl,
      setup: { setup },
      maxSeconds: session.seconds,
      sessionId: session.sessionId,
    } satisfies LiveSessionResponseBody);
  } catch (error) {
    // Logged in full here (a missing key, a quota, a rejected setup); the
    // phone only needs to know it can't start. Nothing was listened to.
    console.error("[api/live-session]", error instanceof Error ? error.message : error);
    await settleLiveSession(auth.userId, session.sessionId, 0);
    return Response.json({ error: "live_unavailable" }, { status: 502 });
  }
}
