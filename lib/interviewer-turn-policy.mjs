export function normalizeInterviewPrompt(value) {
  return typeof value === "string"
    ? value.toLocaleLowerCase().trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "")
    : "";
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
  const questionMarks = (message.match(/\?/g) || []).length;
  if (questionMarks !== 1) return { ok: false, reason: "one_question_required" };

  if (typeof turn.done !== "boolean") return { ok: false, reason: "invalid_completion_flag" };
  if (typeof turn.focus !== "string" || !turn.focus.trim() || turn.focus.trim().length > 80) {
    return { ok: false, reason: "invalid_focus" };
  }

  const normalized = normalizeInterviewPrompt(message);
  const repeated = previousAssistantMessages.some(previous =>
    normalizeInterviewPrompt(previous) === normalized
  );
  if (repeated) return { ok: false, reason: "repeated_question" };

  return {
    ok: true,
    value: { message, done: turn.done, focus: turn.focus.trim() }
  };
}
