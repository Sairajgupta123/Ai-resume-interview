export function isTranscriptRetryCompatible(existing, incoming) {
  return Boolean(
    existing &&
    incoming &&
    existing.interviewId === incoming.interviewId &&
    existing.role === incoming.role &&
    existing.content === incoming.content
  );
}

export function isNextTranscriptRole(previousRole, nextRole) {
  return (previousRole === "user" && nextRole === "assistant") ||
    (previousRole === "assistant" && nextRole === "user");
}
