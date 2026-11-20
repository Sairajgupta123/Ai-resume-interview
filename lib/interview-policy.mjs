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

export function normalizeInterviewQuestion(value) {
  return typeof value === "string"
    ? value.toLocaleLowerCase().trim().replace(/\\s+/g, " ").replace(/[.!?]+$/g, "")
    : "";
}

/**
 * Return the candidate answer immediately following the matching interviewer
 * turn. A report must not borrow a quote from an unrelated answer.
 */
export function findCandidateAnswerForQuestion(question, history) {
  const target = normalizeInterviewQuestion(question);
  if (!target || !Array.isArray(history)) return null;
  for (let index = 0; index < history.length - 1; index++) {
    const prompt = history[index];
    const answer = history[index + 1];
    if (prompt?.role !== "assistant" || answer?.role !== "user" || typeof answer.content !== "string") continue;
    const normalizedPrompt = normalizeInterviewQuestion(prompt.content);
    if (normalizedPrompt === target || (target.length >= 20 && normalizedPrompt.includes(target))) {
      return answer.content;
    }
  }
  return null;
}
