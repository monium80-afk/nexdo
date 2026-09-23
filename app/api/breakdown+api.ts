import { BREAKDOWN_SYSTEM_PROMPT } from "@/data/aiPrompts";
import type { TaskContext } from "@/lib/ai/context";
import { generateStructuredJson, type GeminiJsonSchema } from "@/lib/ai/gemini";
import { languageInstruction } from "@/lib/ai/language";
import type { PlanStep } from "@/lib/ai/types";
import { authenticate, unauthorized } from "@/lib/serverAuth";
import {
  asObject,
  badRequest,
  BadRequestError,
  clampNumber,
  LANGUAGES,
  oneOf,
  parsePlanSteps,
  parseTaskContext,
  readJsonBody,
} from "@/lib/serverRequest";
import type { AppLanguage } from "@/types/settings";

export type BreakdownRequestBody = {
  task: TaskContext;
  /** Steps already checked off — the suggestion only plans what's left. */
  completedSteps: PlanStep[];
  /** The unfinished steps the task has now; a suggestion should differ from these. */
  currentSteps: PlanStep[];
  /** A suggestion the user asked to replace ("Try another"). */
  previousSuggestion: PlanStep[];
  /** The running session's time budget, if there is one. */
  availableMinutes?: number;
  /** The app language — step titles come back in it. */
  language?: AppLanguage;
};

export type BreakdownResponseBody = {
  /** Empty when the model couldn't be reached — the app shows a retry. */
  steps: PlanStep[];
};

const RESPONSE_SCHEMA: GeminiJsonSchema = {
  type: "OBJECT",
  properties: {
    steps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          estimatedMinutes: { type: "NUMBER" },
        },
        required: ["title", "estimatedMinutes"],
      },
    },
  },
  required: ["steps"],
};

const MAX_STEPS = 8;
const MAX_TITLE_LENGTH = 90;

// Same defensive boundary as the inbox route: drop anything that isn't a
// short step title (e.g. the model narrating its reasoning into the field),
// and cap how many steps can land in the card.
function normalizeSteps(raw: unknown): PlanStep[] {
  const steps = raw && typeof raw === "object" ? (raw as { steps?: unknown }).steps : undefined;
  if (!Array.isArray(steps)) return [];

  return steps
    .filter((step): step is { title: unknown; estimatedMinutes: unknown } => !!step && typeof step === "object")
    .map((step) => ({
      title: typeof step.title === "string" ? step.title.trim() : "",
      estimatedMinutes:
        typeof step.estimatedMinutes === "number" && Number.isFinite(step.estimatedMinutes)
          ? Math.max(5, Math.round(step.estimatedMinutes))
          : 15,
    }))
    .filter((step) => step.title.length > 0 && step.title.length <= MAX_TITLE_LENGTH)
    .slice(0, MAX_STEPS);
}

// One task plus three short step lists — a few KB in practice.
const MAX_BODY_BYTES = 64 * 1024;

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

  const language = oneOf(parsed.language, LANGUAGES);

  try {
    const result = await generateStructuredJson({
      systemPrompt: `${BREAKDOWN_SYSTEM_PROMPT}${languageInstruction(language)}`,
      userContent: JSON.stringify({
        task,
        completedSteps: parsePlanSteps(parsed.completedSteps),
        currentSteps: parsePlanSteps(parsed.currentSteps),
        previousSuggestion: parsePlanSteps(parsed.previousSuggestion),
        availableMinutes: clampNumber(parsed.availableMinutes, 0, 10_000) ?? null,
      }),
      responseSchema: RESPONSE_SCHEMA,
    });
    return Response.json({ steps: normalizeSteps(result) } satisfies BreakdownResponseBody);
  } catch (error) {
    console.error("[api/breakdown]", error);
    return Response.json({ steps: [] } satisfies BreakdownResponseBody);
  }
}
