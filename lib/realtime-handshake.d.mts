export function waitForRealtimeSession(
  socket: WebSocket,
  timeoutMs?: number
): Promise<void>;

export function getFinalRealtimeTranscript(data: unknown): { role: "user" | "assistant"; text: string } | null;
