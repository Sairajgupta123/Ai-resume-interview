export const EMPLOYER_DECISIONS = ["shortlist", "review", "reject"] as const;

export function validateEmployerDecisionInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, error: "A valid decision request is required." };
  }
  const value = body as Record<string, unknown>;
  const decision = typeof value.decision === "string" ? value.decision.trim().toLowerCase() : "";
  if (!EMPLOYER_DECISIONS.includes(decision as typeof EMPLOYER_DECISIONS[number])) {
    return { ok: false as const, error: "Choose shortlist, review or reject." };
  }
  if (value.notes !== undefined && value.notes !== null && typeof value.notes !== "string") {
    return { ok: false as const, error: "Decision notes must be plain text." };
  }
  const notes = typeof value.notes === "string" ? value.notes.trim() : "";
  if (notes.length > 3000) {
    return { ok: false as const, error: "Decision notes must be 3,000 characters or fewer." };
  }
  if (!Object.prototype.hasOwnProperty.call(value, "expectedDecisionAt")) {
    return { ok: false as const, error: "Refresh the candidate review before saving a decision." };
  }
  let expectedDecisionAt: Date | null = null;
  if (value.expectedDecisionAt !== null) {
    if (typeof value.expectedDecisionAt !== "string") {
      return { ok: false as const, error: "The decision version is invalid. Refresh the candidate review." };
    }
    expectedDecisionAt = new Date(value.expectedDecisionAt);
    if (!Number.isFinite(expectedDecisionAt.getTime()) || expectedDecisionAt.toISOString() !== value.expectedDecisionAt) {
      return { ok: false as const, error: "The decision version is invalid. Refresh the candidate review." };
    }
  }
  return { ok: true as const, decision, notes, expectedDecisionAt };
}

export function isDecisionVersionCurrent(current: Date | string | null, expected: Date | null) {
  if (current === null || expected === null) return current === null && expected === null;
  const currentTime = current instanceof Date ? current.getTime() : new Date(current).getTime();
  return Number.isFinite(currentTime) && currentTime === expected.getTime();
}
