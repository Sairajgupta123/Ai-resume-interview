export type SkillCoverageStatus = "not_asked" | "asked_unanswered" | "answered";
export type SkillCoverage = { skills: Array<{ skill: string; status: SkillCoverageStatus }>; answered: number; total: number; percent: number; remaining: string[]; followUp: string[] };
export function extractTargetSkills(jobDescription: string, resume?: string, limit?: number): string[];
export function buildSkillCoverage(targetSkills: string[], history: Array<{role: string; content: string}>): SkillCoverage;
export function buildCoverageGuidance(coverage: SkillCoverage): string;
