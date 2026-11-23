export function buildBoundedReportTranscript(messages, maxCharacters = 24_000) {
  if (!Array.isArray(messages) || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    return { messages: [], transcript: "", omittedMessages: Array.isArray(messages) ? messages.length : 0 };
  }
  const normalized = messages.filter(message =>
    message && typeof message === "object" &&
    (message.role === "assistant" || message.role === "user") &&
    typeof message.content === "string" && message.content.length > 0
  );
  const selected = [];
  let used = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    const line = `${message.role}: ${message.content}`;
    const cost = line.length + (selected.length ? 1 : 0);
    // Preserve a contiguous suffix: once the next recent message cannot fit,
    // do not backfill the budget with older messages out of chronological context.
    if (used + cost > maxCharacters) break;
    selected.push({ role: message.role, content: message.content });
    used += cost;
  }
  selected.reverse();
  const transcript = selected.map(message => `${message.role}: ${message.content}`).join("\n");
  return {
    messages: selected,
    transcript,
    omittedMessages: normalized.length - selected.length
  };
}
