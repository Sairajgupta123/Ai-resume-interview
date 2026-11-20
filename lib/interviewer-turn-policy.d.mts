export type InterviewerTurn = { message: string; done: boolean; focus: string };
export type InterviewerTurnValidation =
  | { ok: true; value: InterviewerTurn }
  | { ok: false; reason: string };
export function normalizeInterviewPrompt(value: unknown): string;
export function validateInterviewerTurn(turn: unknown, previousAssistantMessages?: string[]): InterviewerTurnValidation;
