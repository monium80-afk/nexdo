import { EXECUTION_COACH_INTEGRATION_NOTES, EXECUTION_COACH_SYSTEM_PROMPT } from "@/data/aiPrompts";
import type { TaskContext } from "@/lib/ai/context";
import { generateStructuredJson, type GeminiJsonSchema } from "@/lib/ai/gemini";
import { aiUnavailableMessage, languageInstruction } from "@/lib/ai/language";
import { anonymousRateLimit } from "@/lib/anonymousRateLimit";
import { claimTrialCall } from "@/lib/anonymousTrial";
import { authenticate } from "@/lib/serverAuth";
import { claimPlanUsage, refundPlanUsage } from "@/lib/serverPlan";
import {
  asObject,
  badRequest,
  BadRequestError,
  clampArray,
  clampNumber,
  clampString,
  LANGUAGES,
  MAX_ID_LENGTH,
  MAX_TITLE_LENGTH,
  oneOf,
  parseExistingPlan,
  parseTaskContext,
  readJsonBody,
} from "@/lib/serverRequest";
import type { AppLanguage } from "@/types/settings";

export type NextRequestBody = {
  task: TaskContext;
  existingPlan: { id: string; title: string; estimatedMinutes: number; status: string }[];
  availableMinutes?: number;
  /** The app language — advice and step titles come back in it. */
  language?: AppLanguage;
};

export type NextResponseBody = {
  complexity: "simple" | "medium" | "complex";
  advice: string;
  plan: { id: string; title: string; estimatedMinutes: number; status: "pending" | "current" | "completed" }[];
  currentStepId: string | null;
  /** Set when the model couldn't be reached and "advice" is the apology — never worth caching. */
  unavailable?: true;
};

// Every caller reads only "advice", so dropping "plan" looks like free output
// savings — it isn't. Tried and measured: with "advice" as the last field this
// model kept repeating the advice sentence until it hit maxOutputTokens (a
// billed ~2,000-token failure, and the user got the apology), while the full
// schema below stopped cleanly on the same task. With "advice" first it
// stopped, but spent the saved tokens on extra thinking instead. Keep "plan"
// after "advice": it gives the model a clear place to close the string.
const RESPONSE_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    complexity: { type: "STRING", enum: ["simple", "medium", "complex"] },
    advice: { type: "STRING" },
    plan: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          title: { type: "STRING" },
          estimatedMinutes: { type: "NUMBER" },
          status: { type: "STRING", enum: ["pending", "current", "completed"] },
        },
        required: ["id", "title", "estimatedMinutes", "status"],
      },
    },
    currentStepId: { type: "STRING", nullable: true },
  },
  required: ["complexity", "advice", "plan", "currentStepId"],
};

function fallbackResponse(language: AppLanguage | undefined): NextResponseBody {
  return {
    complexity: "simple",
    advice: aiUnavailableMessage(language),
    plan: [],
    currentStepId: null,
    unavailable: true,
  };
}

// One task plus its current plan.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ADVICE_LENGTH = 1_000;
const MAX_PLAN_STEPS = 12;

// The model's answer used to go straight back to the client as
// `result as NextResponseBody` — a cast, so nothing actually checked it. The
// same boundary the breakdown route has: a plan step that isn't a short title
// is the model narrating itself, and the card renders that verbatim.
function normalizeResponse(raw: unknown, language: AppLanguage | undefined): NextResponseBody {
  const result = asObject(raw);
  const plan = clampArray(result.plan, MAX_PLAN_STEPS)
    .map((entry) => {
      const step = asObject(entry);
      const id = clampString(step.id, MAX_ID_LENGTH);
      const title = clampString(step.title, MAX_TITLE_LENGTH);
      if (!id || !title) return null;
      return {
        id,
        title,
        estimatedMinutes: Math.max(5, Math.round(clampNumber(step.estimatedMinutes, 0, 10_000) ?? 15)),
        status: oneOf(step.status, ["pending", "current", "completed"] as const) ?? "pending",
      };
    })
    .filter((step): step is NextResponseBody["plan"][number] => step !== null);

  const currentStepId = clampString(result.currentStepId, MAX_ID_LENGTH);
  const advice = clampString(result.advice, MAX_ADVICE_LENGTH);

  return {
    complexity: oneOf(result.complexity, ["simple", "medium", "complex"] as const) ?? "simple",
    advice: advice ?? aiUnavailableMessage(language),
    plan,
    // Only an id the plan actually contains — a dangling one leaves the card
    // with no current step highlighted.
    currentStepId: currentStepId && plan.some((step) => step.id === currentStepId) ? currentStepId : null,
    ...(advice ? {} : { unavailable: true as const }),
  };
}

// Open to signed-out callers only for onboarding's free run: the decision
// screen (app/onboarding-focus.tsx) shows the AI's advice on the picked task
// BEFORE the user signs up. lib/anonymousTrial.ts allows a signed-out install
// only that; past it, generateAdvice quietly shows its offline heuristic.
// Signed in, each answer is one of the account's breakdowns-and-advice for
// the month (lib/serverPlan.ts).
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("failed" in auth) return auth.failed;
  if (!auth.userId) {
    const rateLimitResponse = anonymousRateLimit(request, "next");
    if (rateLimitResponse) return rateLimitResponse;
  }

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

  const limitResponse = auth.userId
    ? await claimPlanUsage(request, auth.userId, "assist")
    : await claimTrialCall(request, "next");
  if (limitResponse) return limitResponse;

  const language = oneOf(parsed.language, LANGUAGES);

  try {
    const result = await generateStructuredJson({
      label: "next",
      systemPrompt: `${EXECUTION_COACH_SYSTEM_PROMPT}\n\n${EXECUTION_COACH_INTEGRATION_NOTES}${languageInstruction(language)}`,
      userContent: JSON.stringify({
        task,
        existingPlan: parseExistingPlan(parsed.existingPlan),
        availableMinutes: clampNumber(parsed.availableMinutes, 0, 10_000) ?? null,
      }),
      responseSchema: RESPONSE_SCHEMA,
    });
    const response = normalizeResponse(result, language);
    // No advice came back: that isn't one of the month's answers.
    if (response.unavailable && auth.userId) await refundPlanUsage(auth.userId, "assist");
    return Response.json(response);
  } catch (error) {
    console.error("[api/next]", error);
    if (auth.userId) await refundPlanUsage(auth.userId, "assist");
    return Response.json(fallbackResponse(language));
  }
}
