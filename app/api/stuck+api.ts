import { STUCK_SYSTEM_PROMPT } from "@/data/aiPrompts";
import type { TaskContext } from "@/lib/ai/context";
import { generateStructuredJson, type GeminiJsonSchema } from "@/lib/ai/gemini";
import { languageInstruction } from "@/lib/ai/language";
import type { PlanStep } from "@/lib/ai/types";
import { authenticate, unauthorized } from "@/lib/serverAuth";
import { claimPlanUsage, refundPlanUsage } from "@/lib/serverPlan";
import {
  asObject,
  badRequest,
  BadRequestError,
  clampArray,
  clampNumber,
  clampString,
  LANGUAGES,
  oneOf,
  parsePlanSteps,
  parseTaskContext,
  readJsonBody,
} from "@/lib/serverRequest";
import type { AppLanguage } from "@/types/settings";

export type StuckRequestBody = {
  task: TaskContext;
  completedSteps: PlanStep[];
  openSteps: PlanStep[];
  /** Minutes on the session's clock so far. */
  minutesInSession?: number;
  /** Actions already given for this task that the user asked to replace ("Another idea"). */
  previousIdeas: string[];
  language?: AppLanguage;
};

export type StuckResponseBody = {
  /** One small action to start now — null when the model couldn't be reached (the app offers a retry). */
  idea: { action: string; minutes: number } | null;
};

const RESPONSE_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    action: { type: "STRING" },
    minutes: { type: "NUMBER" },
  },
  required: ["action", "minutes"],
};

const MAX_ACTION_LENGTH = 120;
const MAX_PREVIOUS_IDEAS = 6;
const MAX_BODY_BYTES = 64 * 1024;

function normalizeIdea(raw: unknown): StuckResponseBody["idea"] {
  const result = asObject(raw);
  const action = typeof result.action === "string" ? result.action.trim() : "";
  if (!action || action.length > MAX_ACTION_LENGTH) return null;
  const minutes =
    typeof result.minutes === "number" && Number.isFinite(result.minutes) ? Math.round(result.minutes) : 3;
  return { action, minutes: Math.min(5, Math.max(1, minutes)) };
}

/**
 * A focus session's "I'm stuck": one small action to start right now. Counts
 * as one of the month's AI breakdowns (the "assist" meter) — the same
 * allowance as Break it down, so it adds nothing to a Pro account's worst
 * case. Free has none (lib/plan.ts).
 */
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

  const parsed = asObject(raw);
  const task = parseTaskContext(parsed.task);
  if (!task) return badRequest();

  const claimedAt = new Date();
  const limitResponse = await claimPlanUsage(request, auth.userId, "assist");
  if (limitResponse) return limitResponse;

  const language = oneOf(parsed.language, LANGUAGES);
  const previousIdeas = clampArray(parsed.previousIdeas, MAX_PREVIOUS_IDEAS)
    .map((idea) => clampString(idea, MAX_ACTION_LENGTH))
    .filter((idea): idea is string => !!idea);

  try {
    const result = await generateStructuredJson({
      label: "stuck",
      systemPrompt: `${STUCK_SYSTEM_PROMPT}${languageInstruction(language)}`,
      userContent: JSON.stringify({
        task,
        completedSteps: parsePlanSteps(parsed.completedSteps),
        openSteps: parsePlanSteps(parsed.openSteps),
        minutesInSession: clampNumber(parsed.minutesInSession, 0, 10_000) ?? null,
        previousIdeas,
      }),
      responseSchema: RESPONSE_SCHEMA,
    });
    const idea = normalizeIdea(result);
    // Nothing usable: the app offers a retry, and this try isn't counted.
    if (!idea) await refundPlanUsage(auth.userId, "assist", claimedAt);
    return Response.json({ idea } satisfies StuckResponseBody);
  } catch (error) {
    console.error("[api/stuck]", error);
    await refundPlanUsage(auth.userId, "assist", claimedAt);
    return Response.json({ idea: null } satisfies StuckResponseBody);
  }
}
