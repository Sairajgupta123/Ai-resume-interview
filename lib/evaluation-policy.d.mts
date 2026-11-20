export type EvidenceItem = { evidence?: string | null };
export type EvaluationRecommendation = "Strong match" | "Consider" | "Needs review";
export function normalizeSkillName(value: unknown): string;
export function hasDuplicateSkills(skills: unknown[]): boolean;
export function isRatingEvidenceConsistent(rating: string, evidence: string): boolean;
export function calculateEvidenceCoverage(items: EvidenceItem[]): number;
export function deriveRecommendation(score: number, evidenceCoveragePercent: number): EvaluationRecommendation;
