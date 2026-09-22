import { analyzeTaskComplexity } from "@/lib/ai/analyzeComplexity";
import { generatePlan } from "@/lib/ai/generatePlan";
import { recalcTask } from "@/lib/scoring";
import type { Task } from "@/types/task";

// Dates are generated relative to "now" (not hardcoded) so the list always
// shows a realistic mix of overdue/today/upcoming tasks whenever the app runs.
function offsetDate(days: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function hoursAgo(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

type SeedInput = {
  id: string;
  title: string;
  status: "pending" | "completed";
  importance: number;
  dueDate?: string;
  estimatedMinutes: number;
  createdAt: string;
  notes?: string;
};

function buildTask(input: SeedInput): Task {
  const complexity = analyzeTaskComplexity({
    title: input.title,
    estimatedMinutes: input.estimatedMinutes,
  }).complexity;
  const subtasks =
    input.status === "pending"
      ? generatePlan({
          title: input.title,
          estimatedMinutes: input.estimatedMinutes,
          complexity,
        })
      : undefined;

  return recalcTask({
    id: input.id,
    title: input.title,
    status: input.status,
    dueDate: input.dueDate,
    estimatedMinutes: input.estimatedMinutes,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    notes: input.notes,
    subtasks,
    currentStepId: subtasks?.find((subtask) => subtask.status === "current")?.id,
    priorityScore: 0,
    suitabilityScore: 0,
    importance: input.importance,
    complexity,
    aiContext: { notes: [] },
    completedAt: input.status === "completed" ? input.createdAt : undefined,
  }, new Date());
}

export const tasks: Task[] = [
  buildTask({
    id: "tax-documents",
    title: "Submit tax documents",
    status: "pending",
    importance: 75,
    dueDate: offsetDate(-5, 17),
    estimatedMinutes: 45,
    createdAt: hoursAgo(20 * 24),
  }),
  buildTask({
    id: "car-insurance",
    title: "Renew car insurance",
    status: "pending",
    importance: 65,
    dueDate: offsetDate(-1, 9),
    estimatedMinutes: 20,
    createdAt: hoursAgo(15 * 24),
  }),
  buildTask({
    id: "quarterly-report",
    title: "Finish quarterly report",
    status: "pending",
    importance: 90,
    dueDate: offsetDate(0, 18),
    estimatedMinutes: 120,
    createdAt: hoursAgo(3 * 24),
    notes: "Worth 40% of this quarter's performance review.",
  }),
  buildTask({
    id: "chemistry-test",
    title: "Study for chemistry test",
    status: "pending",
    importance: 85,
    dueDate: offsetDate(1, 9),
    estimatedMinutes: 90,
    createdAt: hoursAgo(2 * 24),
  }),
  buildTask({
    id: "weekly-groceries",
    title: "Buy weekly groceries",
    status: "pending",
    importance: 45,
    dueDate: offsetDate(1, 19),
    estimatedMinutes: 30,
    createdAt: hoursAgo(24),
  }),
  buildTask({
    id: "email-professor",
    title: "Email professor about extension",
    status: "pending",
    importance: 55,
    dueDate: offsetDate(3, 12),
    estimatedMinutes: 10,
    createdAt: hoursAgo(4 * 24),
  }),
  buildTask({
    id: "client-proposal-slides",
    title: "Prep client proposal slides",
    status: "pending",
    importance: 70,
    dueDate: offsetDate(3, 15),
    estimatedMinutes: 60,
    createdAt: hoursAgo(6),
  }),
  buildTask({
    id: "clean-garage",
    title: "Clean out garage",
    status: "pending",
    importance: 20,
    dueDate: offsetDate(5, 10),
    estimatedMinutes: 90,
    createdAt: hoursAgo(5 * 24),
  }),
  buildTask({
    id: "weekend-trip",
    title: "Plan weekend trip",
    status: "pending",
    importance: 30,
    dueDate: offsetDate(6, 20),
    estimatedMinutes: 45,
    createdAt: hoursAgo(2 * 24),
  }),
  buildTask({
    id: "reading-chapters",
    title: "Read assigned chapters 4-6",
    status: "pending",
    importance: 40,
    dueDate: offsetDate(9, 21),
    estimatedMinutes: 60,
    createdAt: hoursAgo(3 * 24),
  }),
  buildTask({
    id: "portfolio-website",
    title: "Update portfolio website",
    status: "pending",
    importance: 25,
    dueDate: offsetDate(14, 17),
    estimatedMinutes: 120,
    createdAt: hoursAgo(10 * 24),
  }),
  buildTask({
    id: "digital-photos",
    title: "Organize digital photos",
    status: "pending",
    importance: 15,
    dueDate: offsetDate(21, 12),
    estimatedMinutes: 45,
    createdAt: hoursAgo(12 * 24),
  }),
  buildTask({
    id: "morning-run",
    title: "Morning run",
    status: "completed",
    importance: 35,
    dueDate: offsetDate(-1, 7),
    estimatedMinutes: 30,
    createdAt: hoursAgo(2 * 24),
  }),
  buildTask({
    id: "expense-report",
    title: "Submit expense report",
    status: "completed",
    importance: 70,
    dueDate: offsetDate(-2, 17),
    estimatedMinutes: 20,
    createdAt: hoursAgo(6 * 24),
  }),
  buildTask({
    id: "reading-assignment",
    title: "Finish reading assignment",
    status: "completed",
    importance: 50,
    dueDate: offsetDate(-3, 21),
    estimatedMinutes: 40,
    createdAt: hoursAgo(8 * 24),
  }),
  buildTask({
    id: "water-plants",
    title: "Water the plants",
    status: "completed",
    importance: 10,
    dueDate: offsetDate(-4, 8),
    estimatedMinutes: 10,
    createdAt: hoursAgo(9 * 24),
  }),
];
