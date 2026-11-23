export function extractGrokAssistantText(response) {
  if (!response || typeof response !== "object" || Array.isArray(response) ||
      !Array.isArray(response.choices) || !response.choices[0] ||
      typeof response.choices[0] !== "object") {
    throw new Error("AI returned an unexpected provider response. Please retry.");
  }
  const choice = response.choices[0];
  if (choice.finish_reason === "length") {
    throw new Error("AI returned an incomplete response because the output limit was reached. Please retry.");
  }
  const message = choice.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("AI returned an incomplete response. Please retry.");
  }
  if (typeof message.refusal === "string" && message.refusal.trim()) {
    throw new Error("AI returned a response that could not complete this interview action. Please retry.");
  }
  if (typeof message.content !== "string" || !message.content.trim()) {
    throw new Error("AI returned an empty response. Please retry.");
  }
  return message.content;
}
