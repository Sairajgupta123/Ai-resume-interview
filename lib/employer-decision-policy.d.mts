export const EMPLOYER_DECISIONS: readonly ["shortlist", "review", "reject"];
export function validateEmployerDecisionInput(body: unknown):
  | { ok: true; decision: "shortlist" | "review" | "reject"; notes: string; expectedDecisionAt: Date | null }
  | { ok: false; error: string };
export function isDecisionVersionCurrent(current: Date | string | null, expected: Date | null): boolean;
