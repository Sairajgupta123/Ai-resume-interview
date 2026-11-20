export const DELETION_CONFIRMATION_PHRASE: "REQUEST DELETION";
export function normalizeIdentityValue(value: unknown): string;
export function validateDeletionRequestInput(input: unknown, interview: { candidateName: string; candidateEmail: string | null; role: string } | null): { ok: true; value: { candidateName: string; candidateEmail: string | null; role: string; reason: string } } | { ok: false; status: number; error: string };
