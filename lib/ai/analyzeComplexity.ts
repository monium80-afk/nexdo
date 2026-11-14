import type { ComplexityAnalysis } from "@/lib/ai/types";

const COMPLEX_SIGNAL_VERBS = /\b(write|build|plan|prepare|study for|research|design|launch)\b/i;

export function analyzeTaskComplexity(input: {
  title: string;
  estimatedMinutes: number;
  subtaskCount?: number;
}): ComplexityAnalysis {
  let tier: 0 | 1 | 2 = input.estimatedMinutes <= 20 ? 0 : input.estimatedMinutes <= 89 ? 1 : 2;

  const bumpReasons: string[] = [];
  if ((input.subtaskCount ?? 0) >= 4) {
    tier = Math.min(2, tier + 1) as 0 | 1 | 2;
    bumpReasons.push("has 4+ subtasks");
  }
  if (COMPLEX_SIGNAL_VERBS.test(input.title)) {
    tier = Math.min(2, tier + 1) as 0 | 1 | 2;
    bumpReasons.push("title implies open-ended work");
  }

  const complexity = (["simple", "medium", "complex"] as const)[tier];
  const reasoning =
    bumpReasons.length > 0
      ? `Estimated ${input.estimatedMinutes} min, ${bumpReasons.join(" and ")}.`
      : `Estimated ${input.estimatedMinutes} min of straightforward work.`;

  return { complexity, reasoning };
}
