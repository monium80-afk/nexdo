import { EXECUTION_COACH_INTEGRATION_NOTES, EXECUTION_COACH_SYSTEM_PROMPT } from "@/data/aiPrompts";
import type { TaskContext } from "@/lib/ai/context";
import { generateStructuredJson, type GeminiJsonSchema } from "@/lib/ai/gemini";
import { aiUnavailableMessage, languageInstruction } from "@/lib/ai/language";
import { anonymousRateLimit } from "@/lib/anonymousRateLimit";
import { authenticate } from "@/lib/serverAuth";
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
};

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

  return {
    complexity: oneOf(result.complexity, ["simple", "medium", "complex"] as const) ?? "simple",
    advice: clampString(result.advice, MAX_ADVICE_LENGTH) ?? aiUnavailableMessage(language),
    plan,
    // Only an id the plan actually contains — a dangling one leaves the card
    // with no current step highlighted.
    currentStepId: currentStepId && plan.some((step) => step.id === currentStepId) ? currentStepId : null,
  };
}

// TODO(security): open to signed-out callers for the same reason as
// app/api/inbox+api.ts — the onboarding decision screen
// (app/onboarding-focus.tsx) shows the AI's advice on the picked task BEFORE
// the user signs up. One request is a single Gemini call, and the shared
// anonymous limiter bounds repeated requests per IP. To close it, restore
//     if (!auth.userId) return unauthorized();
// — onboarding then quietly shows generateAdvice's offline heuristic instead.
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

  const language = oneOf(parsed.language, LANGUAGES);

  try {
    const result = await generateStructuredJson({
      systemPrompt: `${EXECUTION_COACH_SYSTEM_PROMPT}\n\n${EXECUTION_COACH_INTEGRATION_NOTES}${languageInstruction(language)}`,
      userContent: JSON.stringify({
        task,
        existingPlan: parseExistingPlan(parsed.existingPlan),
        availableMinutes: clampNumber(parsed.availableMinutes, 0, 10_000) ?? null,
      }),
      responseSchema: RESPONSE_SCHEMA,
    });
    return Response.json(normalizeResponse(result, language));
  } catch (error) {
    console.error("[api/next]", error);
    return Response.json(fallbackResponse(language));
  }
}
