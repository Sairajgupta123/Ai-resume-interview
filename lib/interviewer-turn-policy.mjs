export function normalizeInterviewPrompt(value) {
  return typeof value === "string"
    ? value.toLocaleLowerCase().trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "")
    : "";
}


const QUESTION_STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "could", "do", "does", "for", "from",
  "how", "i", "in", "is", "it", "me", "of", "on", "or", "the", "to",
  "what", "when", "where", "which", "who", "why", "would", "you", "your"
]);

function questionTokens(value) {
  const text = typeof value === "string"
    ? value.toLocaleLowerCase().trim().replace(/\s+/g, " ")
    : "";
  const question = text.slice(0, text.lastIndexOf("?"));
  const lastSentence = question.split(/[.!]/).pop() || question;
  return new Set(
    lastSentence.match(/[a-z0-9+#.]+/g)?.filter(token =>
      token.length > 1 && !QUESTION_STOP_WORDS.has(token)
    ) || []
  );
}

/**
 * Conservative wording-variation guard. It catches near-identical questions
 * without treating questions about the same broad skill as duplicates.
 */
export function areInterviewQuestionsNearDuplicates(first, second) {
  const left = questionTokens(first);
  const right = questionTokens(second);
  if (left.size < 4 || right.size < 4) return false;
  const intersection = [...left].filter(token => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union > 0 && intersection / union >= 0.8;
}

export function validateInterviewerTurn(turn, previousAssistantMessages = []) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return { ok: false, reason: "invalid_turn" };
  }
  if (typeof turn.message !== "string") return { ok: false, reason: "invalid_message" };

  const message = turn.message.trim();
  if (message.length < 20 || message.length > 12000) {
    return { ok: false, reason: "message_length" };
  }
  if (typeof turn.done !== "boolean") return { ok: false, reason: "invalid_completion_flag" };
  const questionMarks = (message.match(/\?/g) || []).length;
  if ((!turn.done && questionMarks !== 1) || (turn.done && questionMarks > 0)) {
    return { ok: false, reason: turn.done ? "closing_must_not_ask_question" : "one_question_required" };
  }
  if (typeof turn.focus !== "string" || !turn.focus.trim() || turn.focus.trim().length > 80) {
    return { ok: false, reason: "invalid_focus" };
  }

  const normalized = normalizeInterviewPrompt(message);
  const repeated = previousAssistantMessages.some(previous =>
    normalizeInterviewPrompt(previous) === normalized
    || areInterviewQuestionsNearDuplicates(previous, message)
  );
  if (repeated) return { ok: false, reason: "repeated_question" };

  return {
    ok: true,
    value: { message, done: turn.done, focus: turn.focus.trim() }
  };
}
