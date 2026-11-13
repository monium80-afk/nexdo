import { LIVE_VOICE_SYSTEM_PROMPT } from "@/data/liveVoicePrompt";
import type { TaskContext } from "@/lib/ai/context";
import { createLiveSessionToken } from "@/lib/ai/gemini";
import { languageName } from "@/lib/ai/language";
import { claimUserCall } from "@/lib/aiUsageLimit";
import { claimTrialCall } from "@/lib/anonymousTrial";
import { MAX_LIVE_SECONDS } from "@/lib/liveVoice";
import { authenticate } from "@/lib/serverAuth";
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

// Live voice (components/MagicMicOverlay.tsx): the phone streams the microphone straight
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

// Gemini 3.1 Flash Live since 2026-10-29. Gemini 3.8 Live had become slow:
// about half the time a finished sentence waited 3–7 s before Google acted on
// it (its speech recognition held it back; marking sentence ends ourselves
// didn't help), where 3.1 Flash Live acted 0.1–0.5 s after every one, with
// the same tool choices, on the same test clips. Same text prices ($0.75/M in,
// $4.50/M out); audio in ≈$0.0045/min (≈$0.005 for 3.8). It's a preview
// model: if Google retires it, try 3.8 Live again first.
const LIVE_MODEL = "models/gemini-3.1-flash-live-preview";

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
    kind: {
      type: "STRING",
      enum: ["routine", "task"],
      description:
        'Only if the user says which: "routine" for a habit kept up (read, gym, vitamins), "task" for a repeating job to get done (rent, weekly report). Leave out otherwise.',
    },
  },
  required: ["frequency"],
};

const FILTER = {
  type: "OBJECT",
  description: "Which tasks, as criteria — for the ones not named by id, or \"all my …\".",
  properties: {
    status: { type: "STRING", enum: ["pending", "completed", "overdue", "all"], description: "pending = still open." },
    titleKeywords: { type: "ARRAY", items: { type: "STRING" }, description: "Words in the task names." },
    dueWithin: { type: "STRING", description: 'Due in this range, in English ("today", "this week", "before friday").' },
    completedWithin: { type: "STRING", description: 'Finished in this range, in English ("yesterday", "last week").' },
    recurring: { type: "BOOLEAN", description: "true = only repeating tasks and routines; false = only one-off tasks." },
    hasDeadline: { type: "BOOLEAN" },
    priority: { type: "STRING", enum: ["high", "medium", "low"] },
  },
};

const SHIFT = {
  type: "OBJECT",
  description: 'Move the deadline by an amount ("two days later" → 2 days; "an hour earlier" → -1 hours).',
  properties: {
    amount: { type: "NUMBER" },
    unit: { type: "STRING", enum: ["minutes", "hours", "days", "weeks", "months"] },
  },
  required: ["amount", "unit"],
};

const MINUTES_DELTA = {
  type: "NUMBER",
  description: 'Add or take away minutes from the length ("it\'ll take 30 more minutes" → 30, "10 minutes less" → -10).',
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

const UPDATE_SCOPE = {
  type: "STRING",
  enum: ["this", "future", "series"],
  description:
    'Repeating tasks only. "this" = just this occurrence ("only today", "push today\'s gym to tonight"). "future" = this one and every later repeat ("from now on", or a change to the task itself: rename it, it takes 45 minutes, it\'s important). "series" = also rename past ones. Moving one day\'s date or time is "this" unless they say "from now on".',
};

const DELETE_SCOPE = {
  type: "STRING",
  enum: ["series", "future"],
  description:
    'Repeating tasks only. "series" (the default) = delete it completely, every repeat. "future" = stop it from now on but keep the times it was already done. To skip just one day, use skip_occurrence instead.',
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
        description:
          "Change an existing task: rename it, move or remove its deadline, change its length or importance, make it repeat or stop repeating, turn it into a routine or a recurring task.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskId: TASK_ID,
            title: { type: "STRING", description: "The new name, only when renaming." },
            estimatedMinutes: { type: "NUMBER", description: "The new length in minutes, only when the user changes it." },
            estimatedMinutesDelta: MINUTES_DELTA,
            ...DETAILS,
            dueDateShift: SHIFT,
            removeDeadline: { type: "BOOLEAN", description: 'true when the task should have no deadline any more ("no due date", "whenever").' },
            repeatType: {
              type: "STRING",
              enum: ["routine", "task"],
              description: 'Turn a repeating task into a "routine" (a habit) or back into a recurring "task", keeping how often it repeats.',
            },
            scope: UPDATE_SCOPE,
          },
          required: ["taskId"],
        },
      },
      {
        name: "complete_task",
        description:
          "Mark a task as done (\"I did it\", \"finished\", \"done\"). For a repeating task this ticks off the current one and the next repeat comes in. NEVER use it to delete or skip.",
        parameters: { type: "OBJECT", properties: { taskId: TASK_ID }, required: ["taskId"] },
      },
      {
        name: "reopen_task",
        description: "Mark a completed task as not done again.",
        parameters: { type: "OBJECT", properties: { taskId: TASK_ID }, required: ["taskId"] },
      },
      {
        name: "delete_task",
        description:
          "Delete a task for good (\"delete\", \"remove\", \"get rid of\", \"cancel\", \"I don't need it any more\"). A repeating task or routine is deleted completely, every repeat, unless the scope says otherwise.",
        parameters: { type: "OBJECT", properties: { taskId: TASK_ID, scope: DELETE_SCOPE }, required: ["taskId"] },
      },
      {
        name: "skip_occurrence",
        description:
          "Repeating tasks and routines only: skip just the current one (\"skip the gym today\", \"not reading tonight\", \"skip this week's report\"). It is not done and not deleted; the next repeat takes its place.",
        parameters: { type: "OBJECT", properties: { taskId: TASK_ID }, required: ["taskId"] },
      },
      {
        name: "change_tasks",
        description:
          "Do the same thing to several tasks at once: \"mark everything due today as done\", \"delete all my completed tasks\", \"move all overdue tasks to tomorrow\", \"make the gym and the essay high priority\".",
        parameters: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", enum: ["complete", "reopen", "delete", "update"] },
            taskIds: { type: "ARRAY", items: { type: "STRING" }, description: "The tasks named, by id." },
            filter: FILTER,
            dueDatePhrase: DETAILS.dueDatePhrase,
            dueDateShift: SHIFT,
            priority: DETAILS.priority,
            estimatedMinutesDelta: MINUTES_DELTA,
          },
          required: ["action"],
        },
      },
      {
        name: "set_steps",
        description:
          "Give a task its steps, as the user lists them (\"break the essay into research, outline, write\"). mode \"add\" keeps the steps it has and adds these after them.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskId: TASK_ID,
            steps: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING", description: "Short, in the user's words." },
                  estimatedMinutes: { type: "NUMBER", description: "What the user said, or your realistic estimate." },
                },
                required: ["title", "estimatedMinutes"],
              },
            },
            mode: { type: "STRING", enum: ["replace", "add"], description: "replace (default) or add." },
          },
          required: ["taskId", "steps"],
        },
      },
      {
        name: "check_step",
        description: "Tick one of a task's steps off (\"I finished the outline\"), or back on with done false. Ticking the last one finishes the task.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskId: TASK_ID,
            step: { type: "NUMBER", description: "The step's number in the task's list, starting at 1." },
            done: { type: "BOOLEAN", description: "false to mark it not done again. Default true." },
          },
          required: ["taskId", "step"],
        },
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
        // The overlay hides the list behind a blur: naming a task brings its
        // card up, so it can be seen before it's changed (the user's ask, 2026-11-02).
        name: "show_task",
        description:
          "Put existing tasks on screen, changing nothing: the user named them or asked about them without saying what to change yet (\"the report…\", \"what about the gym?\", \"show me the essay and the dentist\"), or asked to see a group (\"all my tasks\", \"what's due today?\", \"show me what's overdue\") — then use filter instead of listing ids.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskIds: { type: "ARRAY", items: { type: "STRING" }, description: "The tasks named, by id." },
            filter: FILTER,
          },
        },
      },
      {
        name: "undo_last_change",
        description: "Reverse the most recent change, when the user says undo or that it was wrong.",
        parameters: { type: "OBJECT", properties: {} },
      },
];

const TOOLS = [{ functionDeclarations: FUNCTIONS.map((declaration) => ({ ...declaration, behavior: "NON_BLOCKING" })) }];

// Onboarding's brain dump (app/onboarding/dump.tsx), before any account
// exists: the list is empty and there is nothing to change yet, so the
// session can only add tasks — and only for a minute.
const ONBOARDING_TOOLS = [
  {
    functionDeclarations: FUNCTIONS.filter((declaration) => declaration.name === "add_task").map((declaration) => ({
      ...declaration,
      behavior: "NON_BLOCKING",
    })),
  },
];
export const ONBOARDING_LIVE_SECONDS = 60;
const ONBOARDING_NOTE =
  "SETUP\nThis is the user's first brain dump while setting up Nexdo: they are listing everything on their mind. Their list starts empty. Call add_task once for each separate thing they mention, as soon as they finish saying it. add_task is the only tool here.";

/** One line per task: "t3 | Call the bank | open, Due tomorrow at 6:00 PM, 30 min, high priority". */
function taskLine(task: TaskContext): string {
  const details = [
    task.status === "completed" ? (task.completedLabel ?? "completed") : task.overdue ? "open, OVERDUE" : "open",
    task.status === "completed" ? undefined : task.dueLabel || undefined,
    task.estimatedMinutes > 0 ? `${task.estimatedMinutes} min` : "no duration",
    task.priority ? `${task.priority} priority` : undefined,
    task.repeats ? `repeats ${task.repeats}` : undefined,
    task.steps ? `steps: ${task.steps.map((step, index) => `${index + 1}. ${step}`).join("; ")}` : undefined,
  ].filter(Boolean);
  return `${task.id} | ${task.title} | ${details.join(", ")}`;
}

/** The session every token is locked to. Exported so a live check can open the very same session without Clerk. */
export function liveSetup(body: LiveSessionRequestBody, onboarding = false): Record<string, unknown> {
  const language = body.language && body.language !== "en" ? languageName(body.language) : null;
  const instruction = [
    LIVE_VOICE_SYSTEM_PROMPT,
    onboarding ? ONBOARDING_NOTE : "",
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
    tools: onboarding ? ONBOARDING_TOOLS : TOOLS,
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

/**
 * Onboarding's brain dump, signed out (2026-11-12, the user's call): one
 * 60-second session that can only add tasks, counted against the install's
 * free onboarding run and the server's per-IP and per-day ceilings
 * (lib/anonymousTrial.ts). About half a cent of audio at most.
 */
async function startOnboardingSession(request: Request, raw: unknown): Promise<Response> {
  const body = parseBody(raw);
  // Nothing to change before an account exists: never a task list.
  const setup = liveSetup({ ...body, tasks: [] }, true);
  const trialResponse = await claimTrialCall(request, "live-session");
  if (trialResponse) return trialResponse;
  try {
    const { websocketUrl } = await createLiveSessionToken({ setup, sessionSeconds: ONBOARDING_LIVE_SECONDS + TOKEN_GRACE_SECONDS });
    return Response.json({ url: websocketUrl, setup: { setup }, maxSeconds: ONBOARDING_LIVE_SECONDS } satisfies LiveSessionResponseBody);
  } catch (error) {
    console.error("[api/live-session] onboarding", error instanceof Error ? error.message : error);
    return Response.json({ error: "live_unavailable" }, { status: 502 });
  }
}

// Signed in: part of Pro only (lib/plan.ts), counted in minutes of listening.
// This route takes the session's time from the month up front, and the app
// reports what it really used once it's over (app/api/live-usage+api.ts),
// which gives the rest back. Signed out: onboarding's one short session above.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;

  let raw: unknown;
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BadRequestError) return badRequest();
    throw error;
  }

  if (!auth.userId) return startOnboardingSession(request, raw);

  // Token creation is a Gemini API request, so wait until both account checks
  // pass before spending project request capacity.
  const setup = liveSetup(parseBody(raw));

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
