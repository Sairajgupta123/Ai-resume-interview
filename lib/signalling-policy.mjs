const MAX_SDP_LENGTH = 20_000;
const MAX_ICE_CANDIDATE_LENGTH = 4_096;

function parseObject(payload) {
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function validateSignalPayload(kind, payload, sender) {
  if (typeof payload !== "string" || payload.length < 1 || payload.length > 24_000) {
    return { ok: false, error: "Signalling payload size is invalid." };
  }

  if (kind === "offer" || kind === "answer") {
    // The candidate initiates the peer connection; only the employer may answer.
    // Enforce the protocol at the API boundary, not only in browser UI code.
    if ((kind === "offer" && sender !== "candidate") || (kind === "answer" && sender !== "employer")) {
      return { ok: false, error: "Session description is not allowed for this participant." };
    }
    const description = parseObject(payload);
    if (!description || description.type !== kind || typeof description.sdp !== "string"
      || description.sdp.length < 1 || description.sdp.length > MAX_SDP_LENGTH) {
      return { ok: false, error: "Invalid session description." };
    }
    return { ok: true };
  }

  if (kind === "ice") {
    const candidate = parseObject(payload);
    if (!candidate || typeof candidate.candidate !== "string"
      || candidate.candidate.length > MAX_ICE_CANDIDATE_LENGTH
      || (candidate.sdpMid !== undefined && candidate.sdpMid !== null
        && (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 256))
      || (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null
        && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 255))
      || (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null
        && (typeof candidate.usernameFragment !== "string" || candidate.usernameFragment.length > 256))) {
      return { ok: false, error: "Invalid ICE candidate." };
    }
    return { ok: true };
  }

  if (kind === "hangup") {
    const expected = sender === "candidate" ? "candidate-ended" : "employer-ended";
    return payload === expected
      ? { ok: true }
      : { ok: false, error: "Invalid call termination signal." };
  }

  return { ok: false, error: "Unsupported signalling message." };
}


/**
 * A newer SDP description starts a fresh peer negotiation. Hangup signals
 * from an older negotiation must not terminate the replacement connection.
 */
export function isSignalOlderThanDescription(signalCreatedAt, signalId, descriptionCreatedAt, descriptionId) {
  const signalTime = signalCreatedAt instanceof Date ? signalCreatedAt.getTime() : new Date(signalCreatedAt).getTime();
  const descriptionTime = descriptionCreatedAt instanceof Date ? descriptionCreatedAt.getTime() : new Date(descriptionCreatedAt).getTime();
  if (!Number.isFinite(signalTime) || !Number.isFinite(descriptionTime)) return false;
  return signalTime < descriptionTime || (signalTime === descriptionTime && String(signalId).localeCompare(String(descriptionId)) < 0);
}
