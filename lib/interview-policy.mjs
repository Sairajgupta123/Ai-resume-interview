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
  // Reports promise verbatim candidate-answer evidence. Case-folding or
  // collapsing whitespace would accept text the candidate never actually said.
  const quote = evidence.trim();
  if (quote.length < minimumLength || !Array.isArray(candidateAnswers)) return false;
  return candidateAnswers.some(answer => typeof answer === "string" && answer.includes(quote));
}


// Database context is fetched newest-first for an efficient bounded query.
// Restore chronological order before passing it to the interviewer.
export function restoreChronologicalOrder(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice().reverse();
}
