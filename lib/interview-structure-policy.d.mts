export type InterviewQuestionCategory = "situational" | "project" | "practical" | "technical";
export function classifyInterviewQuestion(question: unknown): InterviewQuestionCategory | null;
export function buildInterviewStructurePlan(history: Array<{ role: string; content: string }>, elapsedSeconds?: number, limitSeconds?: number): {
  categoryCounts: Record<InterviewQuestionCategory, number>;
  remainingCategories: InterviewQuestionCategory[];
  nextCategory: InterviewQuestionCategory | null;
  remainingSeconds: number;
  phase: "wrap_up" | "opening" | "assessment";
};
export function buildInterviewStructureGuidance(plan: ReturnType<typeof buildInterviewStructurePlan> | null): string;

export type InterviewDifficultyLevel = "foundation" | "applied" | "advanced";
export function buildInterviewDifficultyPlan(history: Array<{ role: string; content: string }>): {
  answeredTurns: number;
  level: InterviewDifficultyLevel;
  guidance: string;
};
export function buildInterviewDifficultyGuidance(plan: ReturnType<typeof buildInterviewDifficultyPlan> | null): string;
