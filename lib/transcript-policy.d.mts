type TranscriptEntryIdentity = {
  interviewId: string;
  role: string;
  content: string;
};
export function isTranscriptRetryCompatible(
  existing: TranscriptEntryIdentity | null | undefined,
  incoming: TranscriptEntryIdentity | null | undefined
): boolean;