export type SignalValidationResult = { ok: true } | { ok: false; error: string };
export function validateSignalPayload(
  kind: string,
  payload: string,
  sender: "candidate" | "employer"
): SignalValidationResult;
