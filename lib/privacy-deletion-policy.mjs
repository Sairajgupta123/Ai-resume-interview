export const DELETION_CONFIRMATION_PHRASE = "REQUEST DELETION";
export const MIN_DELETION_REASON_LENGTH = 10;
export const MAX_DELETION_REASON_LENGTH = 1000;

export function normalizeIdentityValue(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en") : "";
}

export function validateDeletionRequestInput(input, interview) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, error: "A valid request body is required." };
  }
  const candidateName = normalizeIdentityValue(input.candidateName);
  const storedName = normalizeIdentityValue(interview?.candidateName);
  if (!candidateName || candidateName !== storedName) {
    return { ok: false, status: 400, error: "Candidate name does not match the selected interview record." };
  }
  const storedEmail = normalizeIdentityValue(interview?.candidateEmail);
  const suppliedEmail = normalizeIdentityValue(input.candidateEmail);
  if (storedEmail && suppliedEmail !== storedEmail) {
    return { ok: false, status: 400, error: "Candidate email does not match the selected interview record." };
  }
  if (!storedEmail && suppliedEmail) {
    return { ok: false, status: 400, error: "This interview has no candidate email on record. Leave the email field blank." };
  }
  if (input.confirmation !== DELETION_CONFIRMATION_PHRASE) {
    return { ok: false, status: 400, error: "Type REQUEST DELETION to confirm this request." };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < MIN_DELETION_REASON_LENGTH || reason.length > MAX_DELETION_REASON_LENGTH) {
    return { ok: false, status: 400, error: "Provide a reason between 10 and 1000 characters." };
  }
  return {
    ok: true,
    value: {
      candidateName: interview.candidateName,
      candidateEmail: interview.candidateEmail || null,
      role: interview.role,
      reason
    }
  };
}
