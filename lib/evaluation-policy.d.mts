export type EvidenceItem = { evidence?: string | null };
export type EvaluationRecommendation = "Strong match" | "Consider" | "Needs review";
export function normalizeSkillName(value: unknown): string;
export function hasDuplicateSkills(skills: unknown[]): boolean;
export function isRatingEvidenceConsistent(rating: string, evidence: string): boolean;
export function calculateEvidenceCoverage(items: EvidenceItem[]): number;
export function deriveRecommendation(score: number, evidenceCoveragePercent: number, skillEvidenceCoveragePercent?: number): EvaluationRecommendation;
export type SkillEvaluation = { skill: string; rating: "Strong" | "Good" | "Developing" | "Insufficient evidence"; evidence: string };
export function completeRequiredSkillEvaluations(requiredSkills: string[], evaluatedSkills: SkillEvaluation[]): SkillEvaluation[];

export function isSkillEvidenceLinkedToQuestion(skill: string, evidence: string, questionFeedback: Array<{ testedSkills: string[]; pairedAnswer?: string | null }>): boolean;
export function buildSkillEvaluationGuidance(): string;
export function buildQuestionAssessmentGuidance(): string;
