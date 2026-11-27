export type RealtimeHistoryMessage = { role: string; content: string };

export function buildRealtimeInterviewInstructions(input: {
  isReconnect: boolean;
  history: RealtimeHistoryMessage[];
  candidateName: string;
  role: string;
  resume: string;
  jobDescription: string;
  openingMessage: string;
}): string;
