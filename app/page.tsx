"use client";

import { useEffect, useRef, useState } from "react";
import { cacheRecordingChunk, clearCachedRecording, getCachedRecording } from "@/lib/recording-cache";
import { GrokRealtimeClient } from "@/lib/grok-realtime-client";

type ChatMessage = { role: "assistant" | "user"; content: string };
type Report = {
  overallScore: number;
  recommendation: string;
  summary: string;
  strengths: string[];
  improvementAreas: string[];
  skills: { skill: string; rating: string; evidence: string }[];
  questionFeedback: { question: string; assessment: string; evidence: string }[];
  disclaimer: string;
};
type InterviewReply = { message: string; done?: boolean; focus?: string; timeLimitReached?: boolean };

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: { length: number; [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void;
};

export default function Home() {
  const [candidateName, setCandidateName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [role, setRole] = useState("");
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [mode, setMode] = useState<"live" | "recorded">("live");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<"setup" | "interview" | "report">("setup");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [recordingSaved, setRecordingSaved] = useState(false);
  const [recoverableRecording, setRecoverableRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"off" | "connecting" | "connected" | "unavailable">("off");
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingCompleteRef = useRef<Promise<boolean> | null>(null);
  const recordingSavedRef = useRef(false);
  const recordingUploadInProgressRef = useRef(false);
  const recordingChunkIndexRef = useRef(0);
  const recordingPersistenceRef = useRef<Promise<void>>(Promise.resolve());
  const recordingPersistenceFailedRef = useRef(false);
  const finishStartedRef = useRef(false);
  const pendingAnswerRef = useRef<{ answer: string; requestId: string } | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const grokVoiceRef = useRef<GrokRealtimeClient | null>(null);
  const transcriptWriteRef = useRef<Promise<void>>(Promise.resolve());
  const transcriptPersistenceFailedRef = useRef(false);
  const pendingTranscriptRef = useRef<Array<{ role: "user" | "assistant"; content: string; clientMessageId: string }>>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedId = params.get("candidateInterviewId");
    const token = params.get("token");
    if (!invitedId) return;
    // Remove the bearer token from the visible URL and browser history before
    // making the exchange request, including when the token later proves invalid.
    if (token) {
      window.history.replaceState({}, "", `/?candidateInterviewId=${encodeURIComponent(invitedId)}`);
    }
    let cancelled = false;
    const invitationUrl = `/api/sessions/${encodeURIComponent(invitedId)}/candidate`;
    fetch(invitationUrl, token
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), credentials: "same-origin", cache: "no-store" }
      : { method: "GET", credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This invitation is invalid or expired.");
        return data.interview;
      })
      .then(interview => {
        if (cancelled) return;
        if (
          !interview ||
          typeof interview !== "object" ||
          typeof interview.id !== "string" ||
          typeof interview.candidateName !== "string" ||
          typeof interview.role !== "string" ||
          typeof interview.resumeText !== "string" ||
          typeof interview.jobDescription !== "string" ||
          !Array.isArray(interview.messages) ||
          (interview.mode !== "live" && interview.mode !== "recorded")
        ) {
          throw new Error("The invitation returned incomplete interview details. Contact the employer for a new link.");
        }
        // The response has now set the HttpOnly cookie for subsequent requests.
        setSessionId(interview.id);
        if (interview.status === "completed" && interview.completedReport && typeof interview.completedReport === "object") {
          setReport(interview.completedReport as Report);
          setPhase("report");
        }
        if (interview.recordingSaved) {
          recordingSavedRef.current = true;
          setRecordingSaved(true);
          void clearCachedRecording(interview.id).catch(() => {});
        } else {
          void getCachedRecording(interview.id).then(cached => {
            if (cached?.chunks.length) setRecoverableRecording(true);
          }).catch(() => setError("A locally saved recording could not be checked. Your interview answers remain available."));
        }
        setCandidateName(interview.candidateName);
        setRole(interview.role);
        setResume(interview.resumeText);
        setJobDescription(interview.jobDescription);
        setMode(interview.mode === "recorded" ? "recorded" : "live");
        setHistory((interview.messages || []).map((message: { role: string; content: string }) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        })));
        if (interview.startedAt && interview.status !== "completed") {
          const elapsed = Math.max(0, Math.floor((Date.now() - new Date(interview.startedAt).getTime()) / 1000));
          setSeconds(Math.min(900, elapsed));
          setPhase("interview");
        }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load invitation."); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (phase !== "interview" || mode !== "live" || !cameraOn || !sessionId || !streamRef.current) return;
    let stopped = false;
    let timer: number | undefined;
    let peer: RTCPeerConnection | null = null;
    let cursor = "";
    let cursorId = "";
    const pendingIce: RTCIceCandidateInit[] = [];
    const headers = { "Content-Type": "application/json" };
    const init = async () => {
      try {
        const iceResponse = await fetch(`/api/sessions/${sessionId}/ice`, { headers: {}, credentials: "same-origin", cache: "no-store" });
        if (!iceResponse.ok) throw new Error("Could not load secure live video connection settings.");
        const { iceServers } = await iceResponse.json();
        if (stopped) return;
        peer = new RTCPeerConnection({ iceServers });
        peerConnectionRef.current = peer;
        let recoveryAttempts = 0;
        let recoveryInProgress = false;
        peer.oniceconnectionstatechange = () => {
          if (stopped || !peer) return;
          if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
            recoveryAttempts = 0;
            setError(current => current.startsWith("Live video connection interrupted") ? "" : current);
            return;
          }
          if (peer.iceConnectionState !== "failed" || recoveryInProgress) return;
          if (recoveryAttempts >= 2) {
            setError("Live video could not recover after two network retries. Check your connection and ask the employer to reconnect.");
            return;
          }
          recoveryAttempts += 1;
          recoveryInProgress = true;
          setError("Live video connection interrupted. Trying to reconnect…");
          void (async () => {
            try {
              const restartOffer = await peer!.createOffer({ iceRestart: true });
              await peer!.setLocalDescription(restartOffer);
              const restartResponse = await fetch(`/api/sessions/${sessionId}/signals`, {
                method: "POST", headers, credentials: "same-origin",
                body: JSON.stringify({ kind: "offer", payload: JSON.stringify(peer!.localDescription) })
              });
              if (!restartResponse.ok) throw new Error("The live video reconnect request was rejected.");
              setError(current => current.startsWith("Live video") ? "" : current);
            } catch (error) {
              if (!stopped) setError(error instanceof Error ? error.message : "Could not restart live video.");
            } finally {
              recoveryInProgress = false;
            }
          })();
        };
        peer.addEventListener("track", event => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
        });
        streamRef.current!.getTracks().forEach(track => peer!.addTrack(track, streamRef.current!));
        peer.onicecandidate = event => {
          if (event.candidate && !stopped) {
            void fetch(`/api/sessions/${sessionId}/signals`, {
              method: "POST", headers, credentials: "same-origin", body: JSON.stringify({ kind: "ice", payload: JSON.stringify(event.candidate.toJSON()) })
            }).then(response => {
              if (!response.ok && !stopped) setError("Live video network setup was interrupted. Please check your connection.");
            }).catch(() => {
              if (!stopped) setError("Could not send live video network information. Check your connection.");
            });
          }
        };
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const offerResponse = await fetch(`/api/sessions/${sessionId}/signals`, {
          method: "POST", headers, credentials: "same-origin", body: JSON.stringify({ kind: "offer", payload: JSON.stringify(peer.localDescription) })
        });
        if (!offerResponse.ok) throw new Error("Could not start live video call.");
        let polling = false;
        const poll = async () => {
          if (stopped || !peer || polling) return;
          polling = true;
          try {
            const response = await fetch(`/api/sessions/${sessionId}/signals?since=${encodeURIComponent(cursor)}&afterId=${encodeURIComponent(cursorId)}`, { headers: {}, credentials: "same-origin", cache: "no-store" });
            if (!response.ok) return;
            const data = await response.json();
            for (const signal of data.signals || []) {
              cursor = signal.createdAt;
              cursorId = signal.id;
              if (signal.kind === "answer" && peer!.signalingState === "have-local-offer") {
                await peer!.setRemoteDescription(JSON.parse(signal.payload));
                for (const candidate of pendingIce.splice(0)) await peer!.addIceCandidate(candidate).catch(() => {});
              }
              if (signal.kind === "ice") {
                const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
                if (peer!.remoteDescription) await peer!.addIceCandidate(candidate).catch(() => {});
                else if (pendingIce.length < 128) pendingIce.push(candidate);
              }
              if (signal.kind === "hangup") { stopped = true; if (timer !== undefined) window.clearInterval(timer); peer!.close(); setError("Employer ended the live video connection."); }
            }
          } catch { /* retry on next poll */ }
          finally { polling = false; }
        };
        void poll();
        timer = window.setInterval(() => void poll(), 1200);
      } catch (error) {
        if (!stopped) setError(error instanceof Error ? error.message : "Could not connect live video.");
      }
    };
    void init();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
      // Effect cleanup also runs for camera toggles and React development remounts.
      // Do not interpret those lifecycle cleanups as the candidate ending the call.
      peer?.close();
      if (peerConnectionRef.current === peer) peerConnectionRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
  }, [phase, mode, cameraOn, sessionId]);

  useEffect(() => {
    if (phase !== "interview") return;
    if (seconds >= 900) { void finishInterview(); return; }
    const timer = window.setTimeout(() => setSeconds((s) => Math.min(900, s + 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, seconds]);

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    grokVoiceRef.current?.close();
    grokVoiceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    if (!recording && !uploadingRecording) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [recording, uploadingRecording]);

  const callApi = async (payload: Record<string, unknown>) => {
    const token = inviteToken || (typeof payload.inviteToken === "string" ? payload.inviteToken : "");
    const { inviteToken: _token, ...requestPayload } = payload;
    const response = await fetch("/api/interview", {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-interview-invite": token } : {}) }, body: JSON.stringify(requestPayload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  };

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.98;
    window.speechSynthesis.speak(utterance);
  };

  const startInterview = async () => {
    if (!candidateName.trim() || !role.trim() || !resume.trim() || !jobDescription.trim()) {
      setError("Please complete candidate name, role, resume and job description."); return;
    }
    if (!consent) { setError("Please confirm consent before starting the interview."); return; }
    setBusy(true); setError("");
    try {
      let activeSessionId = sessionId;
      let activeInviteToken = inviteToken;
      if (!activeSessionId) {
        const saved = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateName, role, resume, jobDescription, mode }) });
        const savedData = await saved.json();
        if (!saved.ok) throw new Error(savedData.error || "Could not create interview session.");
        activeSessionId = savedData.id;
        setSessionId(activeSessionId);
        activeInviteToken = savedData.inviteToken;
        setInviteToken(activeInviteToken);
      }
      const data = await callApi({ action: "start", candidateName, role, resume, jobDescription, mode, sessionId: activeSessionId, consentAccepted: true, inviteToken: activeInviteToken || undefined }) as InterviewReply;
      // The server has exchanged the bearer token for an HttpOnly cookie.
      setInviteToken("");
      const initial = [{ role: "assistant" as const, content: data.message }];
      if (history.length === 0) setHistory(initial);
      setPhase("interview");
      if (mode === "live") {
        await enableCamera(activeSessionId);
        if (streamRef.current) await startGrokVoice(activeSessionId, data.message);
        else speak(data.message);
      } else {
        speak(data.message);
        await enableCamera(activeSessionId);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start interview."); }
    finally { setBusy(false); }
  };

  const sendAnswer = async (value = draft) => {
    const answer = value.trim();
    if (!answer || busy) return;
    if (grokVoiceRef.current) {
      grokVoiceRef.current.close();
      grokVoiceRef.current = null;
      setVoiceStatus("off");
    }
    await transcriptWriteRef.current;
    if (transcriptPersistenceFailedRef.current) { setError("A live transcript could not be saved. Please finish using the saved conversation or contact the employer before continuing."); return; }
    const pending = pendingAnswerRef.current;
    const requestId = pending?.answer === answer ? pending.requestId : crypto.randomUUID();
    pendingAnswerRef.current = { answer, requestId };
    setHistory(prev => {
      const last = prev[prev.length - 1];
      return last?.role === "user" && last.content === answer ? prev : [...prev, { role: "user", content: answer }];
    });
    setDraft(""); setBusy(true); setError("");
    try {
      const data = await callApi({ action: "answer", sessionId, answer, requestId }) as InterviewReply;
      if (sessionId) {
        const durationResponse = await fetch(`/api/sessions/${sessionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(inviteToken ? { "x-interview-invite": inviteToken } : {}) },
          body: JSON.stringify({ durationSeconds: seconds })
        });
        if (!durationResponse.ok) {
          const durationError = await durationResponse.json().catch(() => ({}));
          throw new Error(durationError.error || "Your answer was saved, but the interview status could not be refreshed. Retry safely.");
        }
      }
      // Keep the request ID until every post-answer operation succeeds. If the
      // network drops after the answer transaction commits, a retry recovers
      // the exact saved interviewer response instead of creating another turn.
      pendingAnswerRef.current = null;
      setHistory(prev => [...prev, { role: "assistant", content: data.message }]);
      speak(data.message);
      if (data.done || data.timeLimitReached) await finishInterview();
    } catch (e) {
      setDraft(answer);
      setError(e instanceof Error ? e.message : "Could not submit answer. Your answer is preserved; submit again to retry safely.");
    }
    finally { setBusy(false); }
  };

    const finishInterview = async () => {
    if (finishStartedRef.current) return;
    finishStartedRef.current = true;
    setBusy(true); setError("");
    try {
      // Send an intentional call-end signal before the report completes the interview.
      if (mode === "live" && sessionId) {
        await fetch(`/api/sessions/${sessionId}/signals`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "hangup", payload: "candidate-ended" })
        }).catch(() => {});
      }
      // Stop the realtime connection and flush finalized transcript entries before reporting.
      grokVoiceRef.current?.close();
      grokVoiceRef.current = null;
      setVoiceStatus("off");
      await transcriptWriteRef.current;
      // Retry any entries that failed during the live session. The same UUID makes
      // a retry safe even when the server saved the first request but its response was lost.
      if (pendingTranscriptRef.current.length > 0 && sessionId) {
        const pendingEntries = [...pendingTranscriptRef.current];
        for (const entry of pendingEntries) {
          let saved = false;
          let lastError: Error | null = null;
          for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
              const response = await fetch("/api/sessions/" + sessionId + "/transcript", {
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entry),
                signal: AbortSignal.timeout(10_000)
              });
              const result = await response.json().catch(() => ({}));
              if (!response.ok) {
                const message = typeof result.error === "string" ? result.error : "The live transcript could not be recovered.";
                const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
                throw Object.assign(new Error(message), { retryable });
              }
              pendingTranscriptRef.current = pendingTranscriptRef.current.filter(item => item.clientMessageId !== entry.clientMessageId);
              saved = true;
              break;
            } catch (error) {
              lastError = error instanceof Error ? error : new Error("The live transcript could not be recovered.");
              if (error && typeof error === "object" && "retryable" in error && error.retryable === false) break;
              if (attempt < 3) await new Promise(resolve => window.setTimeout(resolve, 500 * (2 ** attempt)));
            }
          }
          if (!saved) {
            throw new Error((lastError?.message || "The live transcript could not be recovered.") + " The report was not generated.");
          }
        }
      }
      transcriptPersistenceFailedRef.current = pendingTranscriptRef.current.length > 0;
      if (transcriptPersistenceFailedRef.current) throw new Error("The live transcript could not be fully saved, so the report was not generated. Please restore your connection and try again.");
      // Save the recording before the report action closes the interview session.
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
        setRecording(false);
      }
      let recordingSavedOk = recordingSaved;
      if (recordingCompleteRef.current) {
        let recordingWaitTimer: number | undefined;
        try {
          recordingSavedOk = await Promise.race([
            recordingCompleteRef.current,
            new Promise<boolean>((_, reject) => {
              recordingWaitTimer = window.setTimeout(
                () => reject(new Error("Recording upload is taking too long. Your interview report has not been generated yet. Wait for the recording status or recover the saved segments, then try again.")),
                60_000
              );
            })
          ]);
        } finally {
          if (recordingWaitTimer !== undefined) window.clearTimeout(recordingWaitTimer);
        }
      }
      if (!recordingSavedOk && sessionId) {
        const cached = await getCachedRecording(sessionId).catch(() => null);
        if (cached?.chunks.length) {
          setRecoverableRecording(true);
          throw new Error("Your recording is still saved on this device but has not uploaded. Recover it from the camera panel, then end the interview again.");
        }
      }
      const data = await callApi({ action: "report", sessionId }) as Report;
      // The report endpoint records authoritative duration and completes the session atomically.
      // Do not call the general session update endpoint after completion.
      if (!recordingSavedOk && cameraOn) setError("Interview report is ready, but the video recording could not be uploaded. Please check server storage.");
      setReport(data); setPhase("report");
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setCameraOn(false);
    } catch (e) { finishStartedRef.current = false; setError(e instanceof Error ? e.message : "Report generation failed."); }
    finally { setBusy(false); }
  };

  const recoverSavedRecording = async () => {
    if (!sessionId || recordingUploadInProgressRef.current) return;
    recordingUploadInProgressRef.current = true;
    setUploadingRecording(true);
    setError("");
    try {
      const cached = await getCachedRecording(sessionId);
      if (!cached || cached.chunks.length === 0) throw new Error("No recoverable recording segments were found.");
      const blob = new Blob(cached.chunks, { type: cached.mimeType || "video/webm" });
      if (blob.size < 1) throw new Error("The recovered recording is empty.");
      const extension = cached.mimeType.includes("quicktime") ? "mov" : cached.mimeType.includes("mp4") ? "mp4" : "webm";
      const form = new FormData();
      form.append("recording", blob, `mzobs-recovered-${Date.now()}.${extension}`);
      const uploadController = new AbortController();
      const uploadTimeout = window.setTimeout(() => uploadController.abort(), 45_000);
      let response: Response;
      let data: { error?: string };
      try {
        response = await fetch(`/api/sessions/${sessionId}/recording`, {
          method: "POST",
          credentials: "same-origin",
          body: form,
          signal: uploadController.signal
        });
        data = await response.json();
      } catch (uploadError) {
        if (uploadController.signal.aborted) {
          throw new Error("Recording recovery timed out after 45 seconds. Your local recording segments have been kept; you can retry.");
        }
        throw uploadError;
      } finally {
        window.clearTimeout(uploadTimeout);
      }
      if (!response.ok) throw new Error(data.error || "Could not recover the saved recording.");
      recordingSavedRef.current = true;
      setRecordingSaved(true);
      setRecoverableRecording(false);
      // Server confirmation is authoritative. A local cleanup failure must not
      // turn a successfully uploaded recording into a failed recovery.
      await clearCachedRecording(sessionId).catch(() => {});
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not recover the saved recording.");
    } finally {
      recordingUploadInProgressRef.current = false;
      setUploadingRecording(false);
    }
  };

  const startRecording = (stream: MediaStream, targetSessionId = sessionId) => {
    if (typeof MediaRecorder === "undefined") {
      setError("Video recording is not supported in this browser. You can continue the interview, but no video file will be saved.");
      return;
    }
    if (recorderRef.current?.state === "recording" || recordingSavedRef.current || recordingUploadInProgressRef.current) return;
    let resolveCompletion: (saved: boolean) => void = () => {};
    let completionSettled = false;
    let recorderFailed = false;
    const settleCompletion = (saved: boolean) => {
      if (completionSettled) return;
      completionSettled = true;
      resolveCompletion(saved);
    };
    try {
      const preferredTypes = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
      const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recordingChunkIndexRef.current = 0;
      recordingPersistenceRef.current = Promise.resolve();
      recordingPersistenceFailedRef.current = false;
      recordingCompleteRef.current = new Promise<boolean>(resolve => { resolveCompletion = resolve; });
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        chunks.push(event.data);
        const index = recordingChunkIndexRef.current++;
        if (targetSessionId && !recordingPersistenceFailedRef.current) {
          recordingPersistenceRef.current = recordingPersistenceRef.current.then(() => {
            if (recordingPersistenceFailedRef.current) return;
            return cacheRecordingChunk(targetSessionId, index, event.data, recorder.mimeType || "video/webm");
          }).catch(async () => {
            recordingPersistenceFailedRef.current = true;
            await clearCachedRecording(targetSessionId).catch(() => {});
            setError("Local recording backup failed. Keep this tab open until the recording is uploaded.");
          });
        }
      };
      recorder.onerror = () => {
        recorderFailed = true;
        setError("The browser encountered a recording error. This video will not be uploaded as a complete recording; recover any saved segments or continue without a video.");
      };
      recorder.onstop = async () => {
        // Lock the recorder immediately; do not allow a second recording while
        // the final IndexedDB writes and server upload are still in progress.
        recordingUploadInProgressRef.current = true;
        setUploadingRecording(true);
        await recordingPersistenceRef.current;
        try {
          if (recorderFailed) {
            throw new Error("Recording stopped after a browser error. The video was not uploaded; recover saved segments or continue without video.");
          }
          const type = recorder.mimeType || "video/webm";
          const extension = type.includes("quicktime") ? "mov" : type.includes("mp4") ? "mp4" : "webm";
          const filename = `mzobs-interview-${Date.now()}.${extension}`;
          const blob = new Blob(chunks, { type });
          if (!targetSessionId) throw new Error("Interview session is not available for recording upload.");
          if (blob.size < 1) throw new Error("The browser did not produce a video recording. Please retry.");
          const form = new FormData();
          form.append("recording", blob, filename);
          const uploadController = new AbortController();
          const uploadTimeout = window.setTimeout(() => uploadController.abort(), 45_000);
          let response: Response;
          let data: { error?: string };
          try {
            response = await fetch(`/api/sessions/${targetSessionId}/recording`, {
              method: "POST",
              credentials: "same-origin",
              body: form,
              signal: uploadController.signal
            });
            data = await response.json();
          } catch (uploadError) {
            if (uploadController.signal.aborted) {
              throw new Error("Recording upload timed out after 45 seconds. Your locally saved segments will be kept for recovery.");
            }
            throw uploadError;
          } finally {
            window.clearTimeout(uploadTimeout);
          }
          if (!response.ok) throw new Error(data.error || "Recording upload failed.");
          recordingSavedRef.current = true;
          setRecordingSaved(true);
          setRecoverableRecording(false);
          await clearCachedRecording(targetSessionId).catch(() => {});
          settleCompletion(true);
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not upload recording.");
          if (targetSessionId) {
            void getCachedRecording(targetSessionId).then(cached => {
              if (cached?.chunks.length) setRecoverableRecording(true);
            }).catch(() => {});
          }
          settleCompletion(false);
        } finally {
          recordingUploadInProgressRef.current = false;
          setUploadingRecording(false);
        }
      };
      recorder.start(1000);
      setRecording(true);
    } catch {
      recordingUploadInProgressRef.current = false;
      setError("Could not start video recording in this browser.");
      settleCompletion(false);
    }
  };


  const startGrokVoice = async (targetSessionId: string, openingMessage: string, isReconnect = false) => {
    const mediaStream = streamRef.current;
    if (!mediaStream || !targetSessionId) return;

    // Never discard transcript entries from a previous voice connection.
    // Retry them with their original IDs before accepting a new live session.
    await transcriptWriteRef.current;
    if (pendingTranscriptRef.current.length > 0) {
      const pendingEntries = [...pendingTranscriptRef.current];
      for (const entry of pendingEntries) {
        let saved = false;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            const response = await fetch("/api/sessions/" + targetSessionId + "/transcript", {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entry),
              signal: AbortSignal.timeout(10_000)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
              const message = typeof result.error === "string" ? result.error : "Could not recover the previous live transcript.";
              const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
              if (!retryable) throw Object.assign(new Error(message), { retryable: false });
              throw new Error(message);
            }
            pendingTranscriptRef.current = pendingTranscriptRef.current.filter(item => item.clientMessageId !== entry.clientMessageId);
            saved = true;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("Could not recover the previous live transcript.");
            if (error && typeof error === "object" && "retryable" in error && error.retryable === false) break;
            if (attempt < 3) await new Promise(resolve => window.setTimeout(resolve, 500 * (2 ** attempt)));
          }
        }
        if (!saved) {
          transcriptPersistenceFailedRef.current = true;
          setError(lastError?.message || "A previous live transcript could not be recovered. Continue by typing after restoring your connection.");
          setVoiceStatus("unavailable");
          return;
        }
      }
    }
    transcriptPersistenceFailedRef.current = false;
    transcriptWriteRef.current = Promise.resolve();
    const instructions = [
      "You are MZOBS, a professional, fair and concise AI interviewer conducting a structured 15-minute job interview.",
      "Ask one question at a time. Listen carefully and adapt follow-up questions to the candidate's actual answers. Do not repeat questions.",
      "Use resume and job-description context to validate experience, projects, role skills and problem solving. Never invent candidate facts.",
      "Evaluate only job-related answer content. Never infer competence, honesty, emotion, age, gender, disability, race, personality or identity from voice, accent or appearance.",
      "Keep each spoken response natural and concise. In the final 90 seconds ask at most one essential clarification and then close politely.",
      isReconnect
        ? "This is a reconnect to an interview already in progress. Do not restart or repeat the introduction. Continue naturally from the recent conversation below and ask the next appropriate question."
        : "The opening question has already been spoken. Continue from that point; do not repeat the opening.",
      "Recent saved conversation (oldest to newest):\n" + history.slice(-12).map(message => message.role + ": " + message.content).join("\n").slice(-10000),
      "Candidate: " + candidateName + ". Target role: " + role + ".",
      "Candidate resume (private interview context):\n" + resume.slice(0, 14000),
      "Job description:\n" + jobDescription.slice(0, 10000),
      "Opening interviewer message already delivered: " + openingMessage
    ].join("\n\n");
    const client = new GrokRealtimeClient({
      sessionId: targetSessionId,
      stream: mediaStream,
      instructions,
      initialMessage: isReconnect ? "" : openingMessage,
      callbacks: {
        onStatus: status => setVoiceStatus(status === "closed" ? "off" : status),
        onMicrophoneState: state => {
          const mutedMessage = "Your microphone is muted. Unmute it to continue the live voice interview, or type your answer.";
          setError(previous => state === "muted" ? mutedMessage : previous === mutedMessage ? "" : previous);
        },
        onError: message => {
          grokVoiceRef.current?.close();
          grokVoiceRef.current = null;
          setError(message);
          setVoiceStatus("unavailable");
        },
        onTranscript: (speaker, text) => {
          const pendingEntry = { role: speaker, content: text, clientMessageId: crypto.randomUUID() };
          pendingTranscriptRef.current.push(pendingEntry);
          transcriptWriteRef.current = transcriptWriteRef.current.then(async () => {
            let lastError: Error | null = null;
            // Keep the same clientMessageId for every retry: the API uses it to
            // make a timed-out request safe to replay without duplicating a message.
            for (let attempt = 0; attempt < 4; attempt += 1) {
              try {
                const response = await fetch("/api/sessions/" + targetSessionId + "/transcript", {
                  method: "POST",
                  credentials: "same-origin",
                  cache: "no-store",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(pendingEntry),
                  signal: AbortSignal.timeout(10_000)
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                  const message = typeof result.error === "string" ? result.error : "Could not save the live transcript.";
                  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
                  if (!retryable) throw Object.assign(new Error(message), { retryable: false });
                  throw Object.assign(new Error(message), { retryable: true });
                }
                pendingTranscriptRef.current = pendingTranscriptRef.current.filter(entry => entry.clientMessageId !== pendingEntry.clientMessageId);
                setHistory(previous => [...previous, { role: speaker, content: text }]);
                return;
              } catch (error) {
                lastError = error instanceof Error ? error : new Error("Could not save the live transcript.");
                if (error && typeof error === "object" && "retryable" in error && error.retryable === false) break;
                if (attempt < 3) await new Promise(resolve => window.setTimeout(resolve, 500 * (2 ** attempt)));
              }
            }
            throw lastError || new Error("Could not save the live transcript.");
          }).catch(error => {
            transcriptPersistenceFailedRef.current = true;
            setError(error instanceof Error ? error.message : "Could not save the live transcript.");
            setVoiceStatus("unavailable");
            grokVoiceRef.current?.close();
            grokVoiceRef.current = null;
          });
        }
      }
    });
    grokVoiceRef.current = client;
    try {
      await client.connect();
    } catch (error) {
      client.close();
      if (grokVoiceRef.current === client) grokVoiceRef.current = null;
      setVoiceStatus("unavailable");
      setError(error instanceof Error ? error.message : "Could not start Grok voice.");
    }
  };

  const reconnectLiveVoice = async () => {
    if (!sessionId || mode !== "live" || voiceStatus === "connecting" || voiceStatus === "connected") return;
    setError("");
    if (!streamRef.current) await enableCamera(sessionId);
    const mediaStream = streamRef.current;
    if (!mediaStream) {
      setError("Camera and microphone access is required to reconnect live voice. You can continue by typing.");
      return;
    }
    const latestAssistantMessage = [...history].reverse().find(message => message.role === "assistant")?.content || "";
    await startGrokVoice(sessionId, latestAssistantMessage, true);
  };

  const enableCamera = async (targetSessionId = sessionId) => {
    if (cameraRequestRef.current || streamRef.current) return;
    cameraRequestRef.current = true;
    let acquiredStream: MediaStream | null = null;
    let checkingRecordingBackup = false;
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = acquiredStream;
      if (videoRef.current) videoRef.current.srcObject = acquiredStream;
      setCameraOn(true);
      checkingRecordingBackup = Boolean(targetSessionId);
      const cached = targetSessionId ? await getCachedRecording(targetSessionId) : null;
      checkingRecordingBackup = false;
      if (streamRef.current !== acquiredStream || acquiredStream.getTracks().every(track => track.readyState !== "live")) return;
      if (cached?.chunks.length) {
        setRecoverableRecording(true);
      } else {
        startRecording(acquiredStream, targetSessionId);
      }
    } catch (error) {
      acquiredStream?.getTracks().forEach(track => track.stop());
      if (streamRef.current === acquiredStream) streamRef.current = null;
      setCameraOn(false);
      setError(checkingRecordingBackup
        ? (error instanceof Error ? error.message : "Could not verify the saved recording. Keep this tab open and retry before starting a new recording.")
        : "Camera/microphone permission was not granted. You can still answer by typing.");
    } finally {
      cameraRequestRef.current = false;
    }
  };

  const toggleRecording = () => {
    if (!streamRef.current) { setError("Enable camera and microphone before recording."); return; }
    if (recording) {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      setRecording(false);
      return;
    }
    startRecording(streamRef.current);
  };

  const toggleMic = () => {
    if (voiceStatus === "connected" || voiceStatus === "connecting") {
      setError("Grok voice is already using the microphone. Stop the AI voice session before using browser speech input.");
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setError("Speech recognition is not supported in this browser. Please type your answer."); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const recognition = new Recognition();
    recognition.lang = "en-IN"; recognition.interimResults = true; recognition.continuous = false;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      setDraft(text);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition; recognition.start(); setListening(true);
  };

  const formatTime = (n: number) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify({ candidateName, role, report, transcript: history }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `mzobs-interview-report-${Date.now()}.json`; link.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>AI INTERVIEW STUDIO</small></span></a>
        <div className="topbar-right"><span className="secure"><i /> Secure interview workspace</span><a className="avatar" href="/dashboard" aria-label="Employer dashboard">HR</a></div>
      </header>

      {phase === "setup" && <section className="setup-layout">
        <div className="intro">
          <div className="eyebrow"><span /> INTELLIGENT HIRING, HUMAN-CENTRED</div>
          <h1>Meet your next<br /><em>great hire.</em></h1>
          <p>Run structured, role-specific interviews with an AI interviewer that understands the candidate’s experience and the role you’re hiring for.</p>
          <div className="feature-row"><div className="feature-icon">✳</div><div><b>Context-aware questions</b><small>Built from the resume and job description</small></div></div>
          <div className="feature-row"><div className="feature-icon">◉</div><div><b>Voice and video enabled</b><small>Live conversation or recorded session</small></div></div>
          <div className="feature-row"><div className="feature-icon">▤</div><div><b>Evidence-backed reports</b><small>Clear insights for employer review</small></div></div>
          <div className="intro-foot">A smarter way to understand talent. <span>© MZOBS 2026</span></div>
        </div>

        <section className="panel setup-panel">
          <div className="panel-heading"><div><div className="eyebrow">GET STARTED</div><h2>Set up an interview</h2><p>Share the role and candidate context to personalise the session.</p></div><span className="step-pill">01 / 03</span></div>
          <div className="form-grid">
            <label>Candidate name<input value={candidateName} readOnly={!!sessionId} onChange={e => setCandidateName(e.target.value)} placeholder="e.g. Aditi Sharma" /></label>
            <label>Job role<input value={role} readOnly={!!sessionId} onChange={e => setRole(e.target.value)} placeholder="e.g. Frontend Developer" /></label>
            <label className="full">Candidate resume<textarea value={resume} readOnly={!!sessionId} onChange={e => setResume(e.target.value)} rows={5} placeholder="Paste the candidate’s resume text here — skills, experience, projects, education..." /></label>
            <label className="full">Job description<textarea value={jobDescription} readOnly={!!sessionId} onChange={e => setJobDescription(e.target.value)} rows={5} placeholder="Paste the job description — responsibilities, required skills and qualifications..." /></label>
          </div>
          <div className="mode-label">INTERVIEW FORMAT</div>
          <div className="mode-picker">
            <button className={mode === "live" ? "mode-card selected" : "mode-card"} disabled={!!sessionId} onClick={() => setMode("live")}><span className="mode-symbol">◉</span><span><b>Live interview</b><small>Two-way conversation with camera and mic</small></span><span className="radio-dot" /></button>
            <button className={mode === "recorded" ? "mode-card selected" : "mode-card"} disabled={!!sessionId} onClick={() => setMode("recorded")}><span className="mode-symbol">▣</span><span><b>Recorded interview</b><small>Capture a video recording for employer review</small></span><span className="radio-dot" /></button>
          </div>
          <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I understand that my resume, job details and interview answers are processed by xAI Grok. In live mode, microphone audio is streamed to xAI in real time for the spoken AI interview, and finalized text transcripts are saved with my interview. If I grant camera and microphone permission, audio and video recording starts automatically and is uploaded to the interview server for employer review. I can stop recording at any time. The browser temporarily saves recording segments on this device until upload succeeds, so an unfinished upload may be recoverable after a refresh. The assessment is based on my answers, not my appearance, accent or voice characteristics.</span></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-btn" onClick={startInterview} disabled={busy}>{busy ? "Preparing interviewer..." : "Start 15-minute interview"} <span>↗</span></button>
          <p className="privacy-note">Your API key stays on the server. Candidate data is sent to Grok to generate interview questions and evaluation.</p>
        </section>
      </section>}

      {phase === "interview" && <section className="interview-layout">
        <div className="interview-main">
          <div className="session-heading"><div><div className="eyebrow">MZOBS AI INTERVIEWER / SESSION IN PROGRESS</div><h2>{candidateName} <span>· {role}</span></h2><small>{voiceStatus === "connected" ? "GROK REALTIME VOICE CONNECTED" : voiceStatus === "connecting" ? "CONNECTING AI VOICE…" : voiceStatus === "unavailable" ? "VOICE UNAVAILABLE · TEXT INPUT READY" : "TEXT INTERVIEW MODE"}</small></div><div className="timer"><span className="pulse" />{formatTime(seconds)} <small>/ 15:00</small></div></div>
          <div className="conversation">
            {history.map((m, i) => <div className={m.role === "assistant" ? "message ai-message" : "message user-message"} key={i}><div className="message-avatar">{m.role === "assistant" ? "M" : candidateName.slice(0,1).toUpperCase()}</div><div className="message-body"><small>{m.role === "assistant" ? "MZOBS AI INTERVIEWER" : candidateName.toUpperCase()}</small><p>{m.content}</p></div></div>)}
            {busy && <div className="typing"><span /><span /><span /> AI interviewer is thinking</div>}
            <div ref={transcriptEndRef} />
          </div>
          <div className="answer-box"><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Type your answer here..." rows={3} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }} /><div className="answer-actions"><button className={listening ? "tool-btn active" : "tool-btn"} onClick={toggleMic} disabled={voiceStatus === "connected" || voiceStatus === "connecting"}>{listening ? "■ Stop voice input" : "🎙 Use voice"}</button><span>Press Enter to send · Shift + Enter for new line</span><button className="send-btn" onClick={() => sendAnswer()} disabled={busy || !draft.trim()}>Send answer ↗</button></div></div>
          {error && <div className="error-box">{error}</div>}
          <div className="session-footer"><span>✳ AI-generated questions · Job-related evaluation only</span><button onClick={() => finishInterview() } disabled={busy}>End interview & generate report</button></div>
        </div>
        <aside className="side-panel">
          <div className="side-card"><div className="side-card-head"><b>Candidate camera</b><span className={cameraOn ? "live-tag" : "muted-tag"}>{cameraOn ? "CAMERA ON" : "NOT CONNECTED"}</span></div><div className="video-wrap">{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-placeholder">◉<small>Camera preview</small></div>}</div>{mode === "live" && <div className="video-wrap remote-video-wrap"><video ref={remoteVideoRef} autoPlay playsInline /><small>Employer live video · connects when employer joins</small></div>}{mode === "live" && <button className="outline-btn" onClick={() => void reconnectLiveVoice()} disabled={voiceStatus === "connected" || voiceStatus === "connecting"}>{voiceStatus === "connecting" ? "Reconnecting live voice…" : "Reconnect live voice"}</button>}<button className="outline-btn" onClick={() => void enableCamera()} disabled={voiceStatus === "connected" || voiceStatus === "connecting"}>{cameraOn ? "Reconnect camera" : "Enable camera & mic"}</button>{recoverableRecording && !recordingSaved && <div className="privacy-note"><b>Unfinished recording found on this device.</b><p>Your saved video segments can be uploaded to this interview.</p><button className="outline-btn" onClick={() => void recoverSavedRecording()} disabled={uploadingRecording}>Recover saved recording</button></div>}<button className={recording ? "record-btn recording" : "record-btn"} onClick={toggleRecording} disabled={uploadingRecording || recordingSaved || recoverableRecording}>{recording ? "■ Stop & save recording" : recordingSaved ? "✓ Recording saved" : "● Start video recording"}</button>{uploadingRecording && <p className="privacy-note">Saving recording to the interview server…</p>}{recordingSaved && <p className="privacy-note">✓ Recording saved for employer review.</p>}</div>
          <div className="side-card"><b>Interview structure</b><div className="timeline"><div className="timeline-item done"><i />Introduction & background<small>Getting to know the candidate</small></div><div className="timeline-item current"><i />Resume & project deep dive<small>Validating experience and ownership</small></div><div className="timeline-item"><i />Technical & problem solving<small>Role-specific knowledge</small></div><div className="timeline-item"><i />Wrap-up<small>Candidate questions and closing</small></div></div></div>
          <div className="fairness-note"><b>Fair evaluation</b><p>Assessment is based on answer content and job-related evidence—not facial appearance, accent or voice characteristics.</p></div>
        </aside>
      </section>}

      {phase === "report" && report && <section className="report-layout">
        <div className="report-top"><div><div className="eyebrow">INTERVIEW COMPLETE / EMPLOYER REVIEW</div><h1>Interview <em>insights.</em></h1><p>{candidateName} · {role} · {formatTime(seconds)} duration</p></div><div className="report-actions"><button className="outline-btn" onClick={() => window.print()}>Print / Save PDF</button><button className="primary-btn compact" onClick={downloadReport}>Download report JSON ↧</button></div></div>
        {error && <div className="error-box">{error}</div>}
        <div className="score-grid"><div className="score-card"><small>OVERALL SCORE</small><strong>{report.overallScore}<i>/100</i></strong><div className="score-track"><span style={{ width: `${Math.max(0, Math.min(100, report.overallScore))}%` }} /></div></div><div className="recommend-card"><small>AI REVIEW SUGGESTION</small><strong>{report.recommendation}</strong><p>Advisory signal only. Final hiring decision stays with the employer.</p></div></div>
        <div className="report-card"><div className="eyebrow">EXECUTIVE SUMMARY</div><p>{report.summary}</p></div>
        <div className="report-columns"><div className="report-card"><h3>Strengths</h3>{report.strengths.map((x,i)=><div className="bullet good" key={i}>＋ {x}</div>)}</div><div className="report-card"><h3>Development areas</h3>{report.improvementAreas.map((x,i)=><div className="bullet" key={i}>↗ {x}</div>)}</div></div>
        <div className="report-card"><h3>Role skill assessment</h3><div className="skill-table">{report.skills.map((s,i)=><div className="skill-row" key={i}><b>{s.skill}</b><span>{s.rating}</span><p>{s.evidence}</p></div>)}</div></div>
        <div className="report-card"><h3>Question-by-question evidence</h3>{report.questionFeedback.map((q,i)=><div className="feedback-row" key={i}><b>Q{i+1}. {q.question}</b><p>{q.assessment}</p><small>Evidence: {q.evidence}</small></div>)}</div>
        <p className="report-disclaimer">{report.disclaimer || "This AI-generated report is decision support, not an automated hiring decision. Review the transcript and evidence before taking action."}</p>
        <button className="outline-btn back-btn" onClick={() => { finishStartedRef.current = false; setPhase("setup"); setHistory([]); setReport(null); setSeconds(0); setSessionId(""); setInviteToken(""); setConsent(false); setError(""); setRecording(false); setUploadingRecording(false); setRecordingSaved(false); recordingSavedRef.current = false; recordingUploadInProgressRef.current = false; recorderRef.current = null; recordingCompleteRef.current = null; streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current = null; setCameraOn(false); }}>＋ Create another interview</button>
      </section>}
      <footer className="global-footer"><span>MZOBS · AI Interview Studio</span><span>Thoughtful technology. Better hiring.</span></footer>
    </main>
  );
}