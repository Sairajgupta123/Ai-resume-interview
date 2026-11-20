export const INTERVIEW_LIMIT_SECONDS: number;
export function elapsedInterviewSeconds(startedAt: Date | string, nowMs?: number): number;
export function isInterviewTimeLimitReached(startedAt: Date | string, nowMs?: number): boolean;
export function normalizeEvidence(value: string): string;
export function isVerifiableEvidenceQuote(evidence: unknown, candidateAnswers: string[], minimumLength?: number): boolean;
