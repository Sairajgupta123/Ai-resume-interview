export const INTERVIEW_LIMIT_SECONDS = 15 * 60;

export function elapsedInterviewSeconds(startedAt, nowMs = Date.now()) {
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function isInterviewTimeLimitReached(startedAt, nowMs = Date.now()) {
  return elapsedInterviewSeconds(startedAt, nowMs) >= INTERVIEW_LIMIT_SECONDS;
}

export function normalizeEvidence(value) {
  return String(value).toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function isVerifiableEvidenceQuote(evidence, candidateAnswers, minimumLength = 8) {
  if (typeof evidence !== "string" || evidence === "Insufficient evidence") return evidence === "Insufficient evidence";
  const normalized = normalizeEvidence(evidence);
  if (normalized.length < minimumLength) return false;
  return candidateAnswers.some(answer => normalizeEvidence(answer).includes(normalized));
}
