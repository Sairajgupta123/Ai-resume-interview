export type ReportTranscriptMessage = { role: "assistant" | "user"; content: string };
export function buildBoundedReportTranscript(
  messages: unknown,
  maxCharacters?: number
): { messages: ReportTranscriptMessage[]; transcript: string; omittedMessages: number };
