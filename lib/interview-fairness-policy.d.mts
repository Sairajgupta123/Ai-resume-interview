import type { SkillCoverage } from "./skill-coverage-policy.mjs";
export const DEFAULT_INTERVIEW_LIMIT_SECONDS: number;
export const MAX_QUESTIONS_PER_SKILL: number;
export const WRAP_UP_REMAINING_SECONDS: number;
export type InterviewFairnessPlan = {
  coverage: SkillCoverage;
  questionCounts: Array<{ skill: string; questions: number; capped: boolean }>;
  cappedSkills: string[];
  remainingSeconds: number;
  phase: "normal" | "wrap_up";
};
export function buildInterviewFairnessPlan(targetSkills: string[], history: Array<{role: string; content: string}>, elapsedSeconds?: number, limitSeconds?: number): InterviewFairnessPlan;
export function buildFairnessGuidance(plan: InterviewFairnessPlan): string;
