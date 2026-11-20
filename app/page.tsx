"use client";

import { useEffect, useRef, useState } from "react";
import { cacheRecordingChunk, clearCachedRecording, getCachedRecording } from "@/lib/recording-cache";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingCompleteRef = useRef<Promise<boolean> | null>(null);
  const recordingSavedRef = useRef(false);
  const recordingUploadInProgressRef = useRef(false);
  const recordingChunkIndexRef = useRef(0);
  const recordingPersistenceRef = useRef<Promise<void>>(Promise.resolve());
  const finishStartedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedId = params.get("candidateInterviewId");
    const token = params.get("token");
    if (!invitedId) return;
    let cancelled = false;
    const invitationUrl = `/api/sessions/${invitedId}/candidate`;
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
        // The response has now set the HttpOnly cookie; remove the bearer token safely.
        window.history.replaceState({}, "", `/?candidateInterviewId=${encodeURIComponent(invitedId)}`);
        setSessionId(interview.id);
        void getCachedRecording(interview.id).then(cached => {
          if (cached?.chunks.length) setRecoverableRecording(true);
        }).catch(() => setError("A locally saved recording could not be checked. Your interview answers remain available."));
        setCandidateName(interview.candidateName);
        setRole(interview.role);
        setResume(interview.resumeText);
        setJobDescription(interview.jobDescription);
        setMode(interview.mode === "recorded" ? "recorded" : "live");
        setHistory((interview.messages || []).map((message: { role: string; content: string }) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        })));
        if (interview.startedAt) {
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
        peer.addEventListener("track", event => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
        });
        streamRef.current!.getTracks().forEach(track => peer!.addTrack(track, streamRef.current!));
        peer.onicecandidate = event => {
          if (event.candidate && !stopped) void fetch(`/api/sessions/${sessionId}/signals`, {
            method: "POST", headers, credentials: "same-origin", body: JSON.stringify({ kind: "ice", payload: JSON.stringify(event.candidate.toJSON()) })
          });
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
                else pendingIce.push(candidate);
              }
              if (signal.kind === "hangup") { peer!.close(); setError("Employer ended the live video connection."); }
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
      if (peer && peer.connectionState !== "closed") void fetch(`/api/sessions/${sessionId}/signals`, {
        method: "POST", headers, credentials: "same-origin", body: JSON.stringify({ kind: "hangup", payload: "candidate-ended" })
      }).catch(() => {});
      peer?.close();
      if (peerConnectionRef.current === peer) peerConnectionRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
  }, [phase, mode, cameraOn, sessionId, inviteToken]);

  useEffect(() => {
    if (phase !== "interview") return;
    if (seconds >= 900) { void finishInterview(); return; }
    const timer = window.setTimeout(() => setSeconds((s) => Math.min(900, s + 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, seconds]);

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
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
      const initial = [{ role: "assistant" as const, content: data.message }];
      if (history.length === 0) setHistory(initial);
      setPhase("interview"); speak(data.message);
      await enableCamera(activeSessionId);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start interview."); }
    finally { setBusy(false); }
  };

  const sendAnswer = async (value = draft) => {
    const answer = value.trim();
    if (!answer || busy) return;
    const updated = [...history, { role: "user" as const, content: answer }];
    setHistory(updated); setDraft(""); setBusy(true); setError("");
    try {
      const data = await callApi({ action: "answer", candidateName, role, resume, jobDescription, mode, sessionId, history, answer }) as InterviewReply;
      const next = [...updated, { role: "assistant" as const, content: data.message }];
      setHistory(next);
      if (sessionId) await fetch(`/api/sessions/${sessionId}`, { method: "PUT", headers: { "Content-Type": "application/json", ...(inviteToken ? { "x-interview-invite": inviteToken } : {}) }, body: JSON.stringify({ durationSeconds: seconds }) });
      speak(data.message);
      if (data.done || data.timeLimitReached) await finishInterview(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit answer."); }
    finally { setBusy(false); }
  };

  const finishInterview = async (transcript = history) => {
    if (finishStartedRef.current) return;
    finishStartedRef.current = true;
    setBusy(true); setError("");
    try {
      // Save the recording before the report action closes the interview session.
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
        setRecording(false);
      }
      const recordingSavedOk = recordingCompleteRef.current ? await recordingCompleteRef.current : recordingSaved;
      if (!recordingSavedOk && sessionId) {
        const cached = await getCachedRecording(sessionId).catch(() => null);
        if (cached?.chunks.length) {
          setRecoverableRecording(true);
          throw new Error("Your recording is still saved on this device but has not uploaded. Recover it from the camera panel, then end the interview again.");
        }
      }
      const data = await callApi({ action: "report", candidateName, role, resume, jobDescription, history: transcript, sessionId }) as Report;
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
      const extension = cached.mimeType.includes("mp4") ? "mp4" : "webm";
      const form = new FormData();
      form.append("recording", blob, `mzobs-recovered-${Date.now()}.${extension}`);
      const response = await fetch(`/api/sessions/${sessionId}/recording`, {
        method: "POST",
        credentials: "same-origin",
        body: form
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not recover the saved recording.");
      await clearCachedRecording(sessionId);
      setRecoverableRecording(false);
      setRecordingSaved(true);
      recordingSavedRef.current = true;
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
      recordingCompleteRef.current = new Promise<boolean>(resolve => { resolveCompletion = resolve; });
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        chunks.push(event.data);
        const index = recordingChunkIndexRef.current++;
        if (targetSessionId) {
          recordingPersistenceRef.current = recordingPersistenceRef.current.then(() =>
            cacheRecordingChunk(targetSessionId, index, event.data, recorder.mimeType || "video/webm")
          ).catch(() => {
            setError("Local recording backup failed. Keep this tab open until the recording is uploaded.");
          });
        }
      };
      recorder.onerror = () => {
        setError("The browser encountered a video recording error. The recording may be incomplete; the interview answers can still be submitted.");
      };
      recorder.onstop = async () => {
        await recordingPersistenceRef.current;
        recordingUploadInProgressRef.current = true;
        setUploadingRecording(true);
        try {
          const type = recorder.mimeType || "video/webm";
          const extension = type.includes("mp4") ? "mp4" : "webm";
          const filename = `mzobs-interview-${Date.now()}.${extension}`;
          const blob = new Blob(chunks, { type });
          if (!targetSessionId) throw new Error("Interview session is not available for recording upload.");
          if (blob.size < 1) throw new Error("The browser did not produce a video recording. Please retry.");
          const form = new FormData();
          form.append("recording", blob, filename);
          const response = await fetch(`/api/sessions/${targetSessionId}/recording`, {
            method: "POST",
            credentials: "same-origin",
            body: form
          });
          const data = await response.json();
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

  const enableCamera = async (targetSessionId = sessionId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
      const cached = targetSessionId ? await getCachedRecording(targetSessionId).catch(() => null) : null;
      if (cached?.chunks.length) {
        setRecoverableRecording(true);
      } else {
        startRecording(stream, targetSessionId);
      }
    } catch { setError("Camera/microphone permission was not granted. You can still answer by typing."); }
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
          <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I understand that my resume, job details and interview answers are processed by xAI Grok to generate questions and an assessment. If I grant camera and microphone permission, audio and video recording starts automatically and is uploaded to the interview server for employer review. I can stop recording at any time. The browser temporarily saves recording segments on this device until upload succeeds, so an unfinished upload may be recoverable after a refresh. The assessment is based on my answers, not my appearance, accent or voice characteristics.</span></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-btn" onClick={startInterview} disabled={busy}>{busy ? "Preparing interviewer..." : "Start 15-minute interview"} <span>↗</span></button>
          <p className="privacy-note">Your API key stays on the server. Candidate data is sent to Grok to generate interview questions and evaluation.</p>
        </section>
      </section>}

      {phase === "interview" && <section className="interview-layout">
        <div className="interview-main">
          <div className="session-heading"><div><div className="eyebrow">MZOBS AI INTERVIEWER / SESSION IN PROGRESS</div><h2>{candidateName} <span>· {role}</span></h2></div><div className="timer"><span className="pulse" />{formatTime(seconds)} <small>/ 15:00</small></div></div>
          <div className="conversation">
            {history.map((m, i) => <div className={m.role === "assistant" ? "message ai-message" : "message user-message"} key={i}><div className="message-avatar">{m.role === "assistant" ? "M" : candidateName.slice(0,1).toUpperCase()}</div><div className="message-body"><small>{m.role === "assistant" ? "MZOBS AI INTERVIEWER" : candidateName.toUpperCase()}</small><p>{m.content}</p></div></div>)}
            {busy && <div className="typing"><span /><span /><span /> AI interviewer is thinking</div>}
            <div ref={transcriptEndRef} />
          </div>
          <div className="answer-box"><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Type your answer here..." rows={3} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }} /><div className="answer-actions"><button className={listening ? "tool-btn active" : "tool-btn"} onClick={toggleMic}>{listening ? "■ Stop voice input" : "🎙 Use voice"}</button><span>Press Enter to send · Shift + Enter for new line</span><button className="send-btn" onClick={() => sendAnswer()} disabled={busy || !draft.trim()}>Send answer ↗</button></div></div>
          {error && <div className="error-box">{error}</div>}
          <div className="session-footer"><span>✳ AI-generated questions · Job-related evaluation only</span><button onClick={() => finishInterview() } disabled={busy}>End interview & generate report</button></div>
        </div>
        <aside className="side-panel">
          <div className="side-card"><div className="side-card-head"><b>Candidate camera</b><span className={cameraOn ? "live-tag" : "muted-tag"}>{cameraOn ? "CAMERA ON" : "NOT CONNECTED"}</span></div><div className="video-wrap">{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="camera-placeholder">◉<small>Camera preview</small></div>}</div>{mode === "live" && <div className="video-wrap remote-video-wrap"><video ref={remoteVideoRef} autoPlay playsInline /><small>Employer live video · connects when employer joins</small></div>}<button className="outline-btn" onClick={() => void enableCamera()}>{cameraOn ? "Reconnect camera" : "Enable camera & mic"}</button>{recoverableRecording && !recordingSaved && <div className="privacy-note"><b>Unfinished recording found on this device.</b><p>Your saved video segments can be uploaded to this interview.</p><button className="outline-btn" onClick={() => void recoverSavedRecording()} disabled={uploadingRecording}>Recover saved recording</button></div>}<button className={recording ? "record-btn recording" : "record-btn"} onClick={toggleRecording} disabled={uploadingRecording || recordingSaved || recoverableRecording}>{recording ? "■ Stop & save recording" : recordingSaved ? "✓ Recording saved" : "● Start video recording"}</button>{uploadingRecording && <p className="privacy-note">Saving recording to the interview server…</p>}{recordingSaved && <p className="privacy-note">✓ Recording saved for employer review.</p>}</div>
          <div className="side-card"><b>Interview structure</b><div className="timeline"><div className="timeline-item done"><i />Introduction & background<small>Getting to know the candidate</small></div><div className="timeline-item current"><i />Resume & project deep dive<small>Validating experience and ownership</small></div><div className="timeline-item"><i />Technical & problem solving<small>Role-specific knowledge</small></div><div className="timeline-item"><i />Wrap-up<small>Candidate questions and closing</small></div></div></div>
          <div className="fairness-note"><b>Fair evaluation</b><p>Assessment is based on answer content and job-related evidence—not facial appearance, accent or voice characteristics.</p></div>
        </aside>
      </section>}

      {phase === "report" && report && <section className="report-layout">
        <div className="report-top"><div><div className="eyebrow">INTERVIEW COMPLETE / EMPLOYER REVIEW</div><h1>Interview <em>insights.</em></h1><p>{candidateName} · {role} · {formatTime(seconds)} duration</p></div><div className="report-actions"><button className="outline-btn" onClick={() => window.print()}>Print / Save PDF</button><button className="primary-btn compact" onClick={downloadReport}>Download report JSON ↧</button></div></div>
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