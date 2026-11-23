export function isTranscriptRetryCompatible(existing, incoming) {
  return Boolean(
    existing &&
    incoming &&
    existing.interviewId === incoming.interviewId &&
    existing.role === incoming.role &&
    existing.content === incoming.content
  );
}
