export type SignalValidationResult = { ok: true } | { ok: false; error: string };
export function validateSignalPayload(
  kind: string,
  payload: string,
  sender: "candidate" | "employer"
): SignalValidationResult;

export function isSignalOlderThanDescription(
  signalCreatedAt: Date | string,
  signalId: string,
  descriptionCreatedAt: Date | string,
  descriptionId: string
): boolean;
export function isSignalAfterCursor(
  signalCreatedAt: Date | string,
  signalId: string,
  cursorCreatedAt: Date | string,
  cursorId?: string
): boolean;
