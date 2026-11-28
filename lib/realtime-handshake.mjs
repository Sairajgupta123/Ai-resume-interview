export function waitForRealtimeSession(socket, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let opened = false;
    let sessionCreated = false;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const finish = () => {
      if (!opened || !sessionCreated || settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error("AI voice session initialization timed out.")), timeoutMs);
    const onOpen = () => {
      opened = true;
      finish();
    };
    const onMessage = event => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.type === "session.created") {
          sessionCreated = true;
          finish();
        } else if (payload.type === "error") {
          fail(new Error(payload.error?.message || "AI voice session initialization failed."));
        }
      } catch {
        // Ignore non-JSON provider messages while waiting for the handshake.
      }
    };
    const onError = () => fail(new Error("Could not connect to the AI voice service."));
    const onClose = () => fail(new Error("AI voice connection closed during initialization."));

    // Register every listener immediately; session.created can arrive before open.
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}

export function getFinalRealtimeTranscript(data) {
  if (!data || typeof data !== "object") return null;

  if (
    data.type === "conversation.item.input_audio_transcription.completed" &&
    typeof data.transcript === "string" &&
    data.transcript.trim()
  ) {
    return { role: "user", text: data.transcript.trim() };
  }

  if (
    data.type === "response.output_audio_transcript.done" &&
    typeof data.transcript === "string" &&
    data.transcript.trim()
  ) {
    return { role: "assistant", text: data.transcript.trim() };
  }

  // xAI's .updated event is cumulative interim caption text, not a final turn.
  // Persist only the completed event so corrected interim captions cannot
  // become duplicate transcript rows.
  return null;
}


/** Retry only transient failures from the short-lived voice-token endpoint. */
export function isRetryableRealtimeTokenStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}
