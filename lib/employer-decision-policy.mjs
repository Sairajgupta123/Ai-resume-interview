export const EMPLOYER_DECISIONS = ["shortlist", "review", "reject"];

export function validateEmployerDecisionInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid decision request is required." };
  }
  const value = body;
  const decision = typeof value.decision === "string" ? value.decision.trim().toLowerCase() : "";
  if (!EMPLOYER_DECISIONS.includes(decision)) {
    return { ok: false, error: "Choose shortlist, review or reject." };
  }
  if (value.notes !== undefined && value.notes !== null && typeof value.notes !== "string") {
    return { ok: false, error: "Decision notes must be plain text." };
  }
  const notes = typeof value.notes === "string" ? value.notes.trim() : "";
  if (notes.length > 3000) {
    return { ok: false, error: "Decision notes must be 3,000 characters or fewer." };
  }
  if (!Object.prototype.hasOwnProperty.call(value, "expectedDecisionAt")) {
    return { ok: false, error: "Refresh the candidate review before saving a decision." };
  }
  let expectedDecisionAt = null;
  if (value.expectedDecisionAt !== null) {
    if (typeof value.expectedDecisionAt !== "string") {
      return { ok: false, error: "The decision version is invalid. Refresh the candidate review." };
    }
    expectedDecisionAt = new Date(value.expectedDecisionAt);
    if (!Number.isFinite(expectedDecisionAt.getTime()) || expectedDecisionAt.toISOString() !== value.expectedDecisionAt) {
      return { ok: false, error: "The decision version is invalid. Refresh the candidate review." };
    }
  }
  return { ok: true, decision, notes, expectedDecisionAt };
}

export function isDecisionVersionCurrent(current, expected) {
  if (current === null || expected === null) return current === null && expected === null;
  const currentTime = current instanceof Date ? current.getTime() : new Date(current).getTime();
  return Number.isFinite(currentTime) && currentTime === expected.getTime();
}
