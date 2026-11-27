"use client";

import { useEffect, useRef, useState } from "react";
import { buildCsv } from "@/lib/csv-export.mjs";
import RecordingPlayer from "./recording-player";
import { isRestorableInterviewReport } from "@/lib/report-recovery-policy.mjs";
import { isIceCandidateForDescription } from "@/lib/signalling-policy.mjs";

type Item = { id: string; candidateName: string; role: string; mode: string; status: string; overallScore: number | null; recommendation: string | null; employerDecision: string | null; durationSeconds: number; createdAt: string };
type Detail = Item & { candidateEmail?: string | null; resumeText: string; jobDescription: string; hasRecording: boolean; reportJson: string | null; employerNotes: string | null; decisionAt: string | null; decisionHistory: { id: string; decision: string; notes: string | null; createdAt: string }[]; messages: { role: string; content: string }[] };

export default function Dashboard() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<any | null>(null);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [auditError, setAuditError] = useState("");
  const [retentionPreview, setRetentionPreview] = useState<any | null>(null);
  const [retentionError, setRetentionError] = useState("");
  const [deletionRequests, setDeletionRequests] = useState<any[]>([]);
  const [deletionQueueError, setDeletionQueueError] = useState("");
  const [deletionActionBusy, setDeletionActionBusy] = useState("");
  const [deletionQueueMessage, setDeletionQueueMessage] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [inviteReissueBusy, setInviteReissueBusy] = useState(false);
  const [replacementInviteUrl, setReplacementInviteUrl] = useState("");
  const [inviteReissueError, setInviteReissueError] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionMessage, setDeletionMessage] = useState("");
  const [deletionError, setDeletionError] = useState("");
  const employerVideoRef = useRef<HTMLVideoElement>(null);
  const employerLocalRef = useRef<HTMLVideoElement>(null);
  const [liveCallState, setLiveCallState] = useState("Waiting for candidate…");
  const [liveCallAttempt, setLiveCallAttempt] = useState(0);
  const employerPeerRef = useRef<RTCPeerConnection | null>(null);
  const employerStopCallRef = useRef<(() => void) | null>(null);
  // Prevent slower detail requests from replacing a newer candidate selection.
  const detailRequestRef = useRef(0);
  // Ignore older dashboard refreshes when mutations or manual refreshes overlap.
  const dashboardLoadRef = useRef(0);

  useEffect(() => {
    if (!authenticated || !selected || selected.mode !== "live" || selected.status === "completed") {
      setLiveCallState("Live call is not active.");
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let peer: RTCPeerConnection | null = null;
    let localStream: MediaStream | null = null;
    let cursor = "";
    let cursorId = "";
    const stopLocalCall = () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
      peer?.close();
      if (employerPeerRef.current === peer) employerPeerRef.current = null;
      localStream?.getTracks().forEach(track => track.stop());
      localStream = null;
      if (employerLocalRef.current) employerLocalRef.current.srcObject = null;
      if (employerVideoRef.current) employerVideoRef.current.srcObject = null;
    };
    employerStopCallRef.current = stopLocalCall;
    const pendingIce: RTCIceCandidateInit[] = [];
    // Keep a generated answer until the server confirms it. If the POST fails
    // after setLocalDescription(), retry the same answer instead of losing the offer.
    let pendingAnswer: { offerId: string; payload: string } | null = null;
    let answeredOfferId = "";
    const postSignal = (kind: string, payload: string) => fetch(`/api/sessions/${selected.id}/signals`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, payload })
    });
    const start = async () => {
      try {
        setLiveCallState("Loading secure live video settings…");
        const iceResponse = await fetch(`/api/sessions/${selected.id}/ice`, { cache: "no-store" });
        if (!iceResponse.ok) throw new Error("Could not load live video connection settings.");
        const { iceServers } = await iceResponse.json();
        if (stopped) return;
        peer = new RTCPeerConnection({ iceServers });
        employerPeerRef.current = peer;
        peer.ontrack = event => {
          if (employerVideoRef.current) employerVideoRef.current.srcObject = event.streams[0];
          setLiveCallState("Connected · live video and audio");
        };
        peer.onconnectionstatechange = () => {
          if (peer?.connectionState === "connecting") setLiveCallState("Connecting to candidate…");
          if (peer?.connectionState === "connected") setLiveCallState("Connected · live video and audio");
          if (peer?.connectionState === "failed") setLiveCallState("Connection failed. Waiting for the candidate to restart live video…");
          if (peer?.connectionState === "disconnected") setLiveCallState("Candidate connection interrupted. Waiting for automatic recovery…");
        };
        peer.oniceconnectionstatechange = () => {
          if (peer?.iceConnectionState === "connected" || peer?.iceConnectionState === "completed") {
            setLiveCallState("Connected · live video and audio");
          } else if (peer?.iceConnectionState === "failed") {
            setLiveCallState("Network path failed. Waiting for the candidate’s ICE restart…");
          } else if (peer?.iceConnectionState === "disconnected") {
            setLiveCallState("Network interrupted. Waiting for automatic recovery…");
          }
        };
        peer.onicecandidate = event => {
          if (event.candidate && !stopped) {
            void postSignal("ice", JSON.stringify(event.candidate.toJSON())).then(response => {
              if (!response.ok && !stopped) setLiveCallState("Could not exchange live network information. Check the connection and retry.");
            }).catch(() => {
              if (!stopped) setLiveCallState("Live network signalling failed. Check the connection.");
            });
          }
        };
        setLiveCallState("Requesting employer camera and microphone…");
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (stopped) { localStream.getTracks().forEach(track => track.stop()); return; }
        if (employerLocalRef.current) employerLocalRef.current.srcObject = localStream;
        localStream.getTracks().forEach(track => peer!.addTrack(track, localStream!));
        setLiveCallState("Waiting for candidate to join…");
        let polling = false;
        const poll = async () => {
          if (stopped || !peer || polling) return;
          polling = true;
          try {
            const response = await fetch(`/api/sessions/${selected.id}/signals?since=${encodeURIComponent(cursor)}&afterId=${encodeURIComponent(cursorId)}`, { cache: "no-store" });
            if (!response.ok) return;
            const data = await response.json();
            if (pendingAnswer) {
              const retryResponse = await postSignal("answer", pendingAnswer.payload);
              if (!retryResponse.ok) throw new Error("The live call answer could not be sent. Retrying…");
              answeredOfferId = pendingAnswer.offerId;
              pendingAnswer = null;
              setLiveCallState("Answer sent · connecting…");
            }
            for (const signal of data.signals || []) {
              if (signal.kind === "offer" && peer!.signalingState === "stable" && signal.id !== answeredOfferId) {
                await peer!.setRemoteDescription(JSON.parse(signal.payload));
                const activeRemoteDescription = peer!.remoteDescription;
                const readyIce = pendingIce.splice(0).filter(candidate => isIceCandidateForDescription(candidate, activeRemoteDescription));
                for (const candidate of readyIce) await peer!.addIceCandidate(candidate).catch(() => {});
                const answer = await peer!.createAnswer();
                await peer!.setLocalDescription(answer);
                pendingAnswer = { offerId: signal.id, payload: JSON.stringify(peer!.localDescription) };
                const answerResponse = await postSignal("answer", pendingAnswer.payload);
                if (!answerResponse.ok) throw new Error("The live call answer could not be sent. Retrying…");
                answeredOfferId = signal.id;
                pendingAnswer = null;
                setLiveCallState("Answer sent · connecting…");
              } else if (signal.kind === "ice") {
                const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
                if (peer!.remoteDescription && isIceCandidateForDescription(candidate, peer!.remoteDescription)) {
                  await peer!.addIceCandidate(candidate).catch(() => {});
                } else if (pendingIce.length < 128) {
                  pendingIce.push(candidate);
                }
              } else if (signal.kind === "hangup") {
                stopLocalCall();
                setLiveCallState("Candidate ended the call.");
              }
              // Advance only after this signal has been handled. If handling an
              // offer/answer fails, the next poll can replay it safely.
              cursor = signal.createdAt;
              cursorId = signal.id;
            }
          } catch { /* retry on transient network errors */ }
          finally { polling = false; }
        };
        void poll();
        timer = window.setInterval(() => void poll(), 1000);
      } catch (error) {
        if (!stopped) setLiveCallState(error instanceof Error ? error.message : "Could not start live call.");
      }
    };
    void start();
    return () => {
      stopLocalCall();
      if (employerStopCallRef.current === stopLocalCall) employerStopCallRef.current = null;
    };
  }, [authenticated, selected?.id, selected?.mode, selected?.status, liveCallAttempt]);

  const endLiveCall = async () => {
    if (!selected || selected.mode !== "live" || selected.status === "completed") return;
    let notified = false;
    try {
      const response = await fetch(`/api/sessions/${selected.id}/signals`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "hangup", payload: "employer-ended" })
      });
      notified = response.ok;
    } catch {
      notified = false;
    } finally {
      employerStopCallRef.current?.();
      employerStopCallRef.current = null;
      employerPeerRef.current?.close();
      employerPeerRef.current = null;
      const stream = employerLocalRef.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
      if (employerLocalRef.current) employerLocalRef.current.srcObject = null;
      if (employerVideoRef.current) employerVideoRef.current.srcObject = null;
      setLiveCallState(notified
        ? "You ended the live video connection."
        : "Live connection ended on this device, but the employer could not notify the candidate. Refresh and check the interview before reconnecting.");
    }
  };

  const load = async () => {
    const requestId = ++dashboardLoadRef.current;
    const r = await fetch("/api/sessions", { cache: "no-store" });
    if (requestId !== dashboardLoadRef.current) return;
    if (r.status === 401) { setAuthenticated(false); return; }
    const data: unknown = await r.json();
    if (requestId !== dashboardLoadRef.current) return;
    if (!r.ok) {
      const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Could not load employer interviews.";
      throw new Error(message);
    }
    if (!data || typeof data !== "object" || !("interviews" in data) || !Array.isArray(data.interviews)) {
      throw new Error("The employer interview list response was invalid. Refresh and try again.");
    }
    setItems(data.interviews as Item[]);
    setNextCursor("nextCursor" in data && typeof data.nextCursor === "string" ? data.nextCursor : null);
    setHasMore("hasMore" in data && data.hasMore === true);
    setAuthenticated(true);
    const fetchPanel = async (url: string, fallback: string) => {
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || fallback);
      return data;
    };
    const [analyticsResult, auditResult, retentionResult, deletionQueueResult] = await Promise.allSettled([
      fetchPanel("/api/employer/analytics", "Analytics unavailable."),
      fetchPanel("/api/employer/audit", "Audit history unavailable."),
      fetchPanel("/api/employer/privacy/retention", "Retention preview unavailable."),
      fetchPanel("/api/employer/privacy/deletion-requests", "Deletion queue unavailable.")
    ]);
    if (requestId !== dashboardLoadRef.current) return;

    if (analyticsResult.status === "fulfilled") {
      setAnalytics(analyticsResult.value.analytics);
      setAnalyticsError("");
    } else {
      setAnalyticsError(analyticsResult.reason instanceof Error ? analyticsResult.reason.message : "Analytics unavailable.");
    }

    if (auditResult.status === "fulfilled") {
      setAuditEvents(auditResult.value.events || []);
      setAuditError("");
    } else {
      setAuditError(auditResult.reason instanceof Error ? auditResult.reason.message : "Audit history unavailable.");
    }

    if (retentionResult.status === "fulfilled") {
      setRetentionPreview(retentionResult.value.preview);
      setRetentionError("");
    } else {
      setRetentionError(retentionResult.reason instanceof Error ? retentionResult.reason.message : "Retention preview unavailable.");
    }

    if (deletionQueueResult.status === "fulfilled") {
      setDeletionRequests(deletionQueueResult.value.requests || []);
      setDeletionQueueError("");
    } else {
      setDeletionQueueError(deletionQueueResult.reason instanceof Error ? deletionQueueResult.reason.message : "Deletion queue unavailable.");
    }
  };

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(async d => {
      if (d.authenticated) await load();
    }).catch(() => setError("Could not connect to server.")).finally(() => setChecking(false));
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const d = await r.json();
    if (!r.ok) { setError(d.error || "Login failed."); return; }
    setPassword(""); await load();
  };

  const openDetail = async (id: string) => {
    const requestId = ++detailRequestRef.current;
    setSelected(null);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Could not load interview.";
        throw new Error(message);
      }
      if (!data || typeof data !== "object" || !("interview" in data) ||
          !data.interview || typeof data.interview !== "object" || !("id" in data.interview) ||
          data.interview.id !== id || !("messages" in data.interview) || !Array.isArray(data.interview.messages) ||
          !("decisionHistory" in data.interview) || !Array.isArray(data.interview.decisionHistory)) {
        throw new Error("The interview response was incomplete. Refresh the dashboard and try again.");
      }
      if (requestId !== detailRequestRef.current) return;
      const interview = data.interview as Detail;
      setReplacementInviteUrl("");
      setInviteReissueError("");
      setSelected(interview);
      setDecisionNotes(typeof interview.employerNotes === "string" ? interview.employerNotes : "");
    } catch (failure) {
      if (requestId === detailRequestRef.current) {
        setError(failure instanceof Error ? failure.message : "Could not load interview.");
      }
    }
  };

  const closeDetail = () => {
    detailRequestRef.current += 1;
    setSelected(null);
    setReplacementInviteUrl("");
    setInviteReissueError("");
  };

  const reissueInvitation = async () => {
    if (!selected || selected.status !== "invited" || inviteReissueBusy) return;
    const targetId = selected.id;
    const requestId = detailRequestRef.current;
    setInviteReissueBusy(true);
    setInviteReissueError("");
    setReplacementInviteUrl("");
    try {
      const response = await fetch("/api/sessions/" + encodeURIComponent(targetId) + "/invite", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Could not create a replacement invitation.";
        throw new Error(message);
      }
      if (!data || typeof data !== "object" || !("inviteUrl" in data) || typeof data.inviteUrl !== "string") {
        throw new Error("The invitation was updated, but the replacement link could not be confirmed. Refresh and check the interview.");
      }
      if (detailRequestRef.current === requestId) setReplacementInviteUrl(data.inviteUrl);
    } catch (failure) {
      if (detailRequestRef.current === requestId) {
        setInviteReissueError(failure instanceof Error ? failure.message : "Could not create a replacement invitation.");
      }
    } finally {
      setInviteReissueBusy(false);
    }
  };

  const saveDecision = async (decision: "shortlist" | "review" | "reject") => {
    if (!selected || decisionBusy) return;
    const targetInterviewId = selected.id;
    const detailRequestId = detailRequestRef.current;
    setDecisionBusy(true); setError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(selected.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: decisionNotes })
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Could not save decision.";
        throw new Error(message);
      }
      if (!data || typeof data !== "object" || !("decision" in data) || data.decision !== decision ||
          !("decisionHistory" in data) || !Array.isArray(data.decisionHistory)) {
        throw new Error("The decision was saved, but its updated history could not be confirmed. Refresh the interview.");
      }
      // Do not let a late save response reopen a closed drawer or overwrite
      // a different candidate selected while this decision was being saved.
      if (detailRequestRef.current === detailRequestId) {
        setSelected(current => current?.id === targetInterviewId ? {
          ...current,
          employerDecision: decision,
          employerNotes: "notes" in data && typeof data.notes === "string" ? data.notes : null,
          decisionAt: "decisionAt" in data && typeof data.decisionAt === "string" ? data.decisionAt : current.decisionAt,
          decisionHistory: data.decisionHistory as Detail["decisionHistory"]
        } : current);
      }
      try {
        await load();
      } catch {
        setError("Decision saved, but the dashboard list could not refresh. Refresh the page to see the latest data.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save decision.");
    } finally {
      setDecisionBusy(false);
    }
  };

  const logout = async () => { dashboardLoadRef.current += 1; detailRequestRef.current += 1; await fetch("/api/auth/logout", { method: "POST" }); setAuthenticated(false); setSelected(null); };
  const filtered = items.filter(x => `${x.candidateName} ${x.role}`.toLowerCase().includes(query.toLowerCase()));
  const compared = items.filter(x => compareIds.includes(x.id));
  const toggleCompare = (id: string) => {
    setComparison(null);
    setCompareIds(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 3 ? [...current, id] : current);
  };
  const runEvidenceComparison = async () => {
    if (compareIds.length < 2 || comparisonBusy) return;
    setComparisonBusy(true); setError("");
    try {
      const response = await fetch("/api/employer/compare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewIds: compareIds })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not compare candidates.");
      setComparison(data.comparison);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not compare candidates.");
    } finally {
      setComparisonBusy(false);
    }
  };
  const runDeletionAction = async (requestId: string, interviewId: string, action: "send" | "approve" | "execute") => {
    const key = requestId + ":" + action;
    setDeletionActionBusy(key); setDeletionQueueMessage(""); setDeletionQueueError("");
    try {
      const endpoint = action === "send"
        ? "/api/employer/privacy/deletion-requests/" + encodeURIComponent(interviewId) + "/send-verification"
        : action === "approve"
          ? "/api/employer/privacy/deletion-requests/" + encodeURIComponent(requestId) + "/approve"
          : "/api/employer/privacy/deletion-requests/" + encodeURIComponent(requestId) + "/execute";
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Privacy action failed.");
      setDeletionQueueMessage(data.message || "Privacy workflow updated.");
      await load();
    } catch (failure) {
      setDeletionQueueError(failure instanceof Error ? failure.message : "Privacy action failed.");
    } finally { setDeletionActionBusy(""); }
  };
  const createDeletionRequest = async () => {
    if (!selected) return;
    setDeletionBusy(true);
    setDeletionMessage("");
    setDeletionError("");
    try {
      const response = await fetch("/api/employer/privacy/deletion-requests/" + encodeURIComponent(selected.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName: selected.candidateName,
          candidateEmail: selected.candidateEmail || "",
          reason: deletionReason,
          confirmation: deletionConfirmation
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create deletion request.");
      setDeletionMessage("Request recorded. Candidate verification and separate approval are still required. No data has been deleted.");
      setDeletionReason("");
      setDeletionConfirmation("");
      await load();
    } catch (failure) {
      setDeletionError(failure instanceof Error ? failure.message : "Could not create deletion request.");
    } finally {
      setDeletionBusy(false);
    }
  };
  const loadMore = async () => {
    if (!nextCursor || !hasMore || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetch("/api/sessions?cursor=" + encodeURIComponent(nextCursor), { cache: "no-store" });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Could not load more interviews.";
        throw new Error(message);
      }
      if (!data || typeof data !== "object" || !("interviews" in data) || !Array.isArray(data.interviews)) {
        throw new Error("The next interview page response was invalid. Refresh and try again.");
      }
      setItems(current => {
        const known = new Set(current.map(item => item.id));
        return [...current, ...(data.interviews as Item[]).filter(item => !known.has(item.id))];
      });
      setNextCursor("nextCursor" in data && typeof data.nextCursor === "string" ? data.nextCursor : null);
      setHasMore("hasMore" in data && data.hasMore === true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load more interviews.");
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = () => {
    const columns = ["Candidate", "Role", "Mode", "Status", "AI score", "AI recommendation", "Employer decision", "Duration seconds", "Created at"];
    const rows = items.map(item => [item.candidateName, item.role, item.mode, item.status, item.overallScore ?? "", item.recommendation ?? "", item.employerDecision ?? "", item.durationSeconds, item.createdAt]);
    const csv = buildCsv(columns, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "mzobs-interview-candidates.csv";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Let the browser begin consuming the object URL before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const date = (v: string) => new Date(v).toLocaleString();

  if (checking) return <main className="dashboard-shell"><p>Loading secure dashboard…</p></main>;
  if (!authenticated) return <main className="login-shell"><form className="login-card" onSubmit={login}><a className="brand" href="/"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>EMPLOYER WORKSPACE</small></span></a><div className="eyebrow">SECURE ACCESS</div><h1>Welcome back.</h1><p>Sign in to review candidate interviews and AI-generated evidence.</p><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div className="error-box">{error}</div>}<button className="primary-btn">Sign in <span>↗</span></button><a className="back-link" href="/">← Back to interview setup</a></form></main>;

  return <main className="dashboard-shell">
    <header className="dashboard-header"><a className="brand" href="/"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>EMPLOYER WORKSPACE</small></span></a><div className="header-actions"><span className="secure"><i/> Signed in</span><button className="outline-btn" onClick={logout}>Sign out</button></div></header>
    <section className="dashboard-title"><div><div className="eyebrow">HIRING INTELLIGENCE</div><h1>Interview <em>overview.</em></h1><p>Review candidate conversations, role alignment and evidence-backed AI reports.</p></div><a className="primary-link" href="/dashboard/new">＋ Invite candidate</a></section>
    <div className="metric-row"><div className="metric"><small>TOTAL INTERVIEWS</small><strong>{analytics ? analytics.total : items.length}</strong></div><div className="metric"><small>COMPLETED</small><strong>{analytics ? analytics.completed : items.filter(x=>x.status==="completed").length}</strong></div><div className="metric"><small>AVERAGE SCORE</small><strong>{analytics ? (analytics.averageScore ?? "—") : (items.filter(x=>x.overallScore!==null).length ? Math.round(items.reduce((a,x)=>a+(x.overallScore||0),0)/items.filter(x=>x.overallScore!==null).length) : "—")}</strong></div></div>
    <section className="analytics-section">
      <div className="analytics-heading"><div><div className="eyebrow">WORKFORCE INSIGHTS</div><h2>Hiring analytics.</h2><p>Operational trends from interview activity and employer decisions.</p></div><span className="analytics-updated">Live from interview records</span></div>
      {analyticsError && <div className="error-box">{analyticsError}</div>}
      {analytics && <>
        <div className="analytics-kpis">
          <div className="analytics-kpi"><small>COMPLETION RATE</small><strong>{analytics.completionRate}%</strong><span>{analytics.completed} of {analytics.total} interviews completed</span></div>
          <div className="analytics-kpi"><small>INVITED</small><strong>{analytics.invited}</strong><span>Awaiting candidate activity</span></div>
          <div className="analytics-kpi"><small>IN PROGRESS</small><strong>{analytics.inProgress}</strong><span>Active interview sessions</span></div>
          <div className="analytics-kpi"><small>SCORED INTERVIEWS</small><strong>{analytics.scoredCount}</strong><span>Average score: {analytics.averageScore === null ? "—" : analytics.averageScore + "/100"}</span></div>
        </div>
        <div className="analytics-grid">
          <article className="analytics-card analytics-trend"><div className="analytics-card-heading"><div><h3>Interview activity</h3><p>Six-week activity · total and completed</p></div></div>
            <div className="trend-legend"><span><i className="legend-total"/> Total</span><span><i className="legend-completed"/> Completed</span></div>
            <div className="trend-list">{analytics.weeklyTrend.map((week: any) => {
              const max = Math.max(1, ...analytics.weeklyTrend.map((entry: any) => entry.total));
              return <div className="trend-row" key={week.weekStart}><span>{week.label}</span><div className="trend-track"><div className="trend-total" style={{width: (week.total / max * 100) + "%"}}/><div className="trend-completed" style={{width: (week.completed / max * 100) + "%"}}/></div><b>{week.total}</b></div>;
            })}</div>
          </article>
          <article className="analytics-card"><div className="analytics-card-heading"><div><h3>Employer decisions</h3><p>Human decisions recorded in the workspace</p></div></div>
            <div className="decision-bars">{[{key:"shortlist",label:"Shortlisted",color:"shortlist"},{key:"review",label:"Needs review",color:"review"},{key:"reject",label:"Rejected",color:"reject"},{key:"pending",label:"Pending",color:"pending"}].map((item: any) => <div className="decision-bar-row" key={item.key}><div><span>{item.label}</span><b>{analytics.decisions[item.key]}</b></div><div className="decision-track"><i className={item.color} style={{width: (analytics.total ? analytics.decisions[item.key] / analytics.total * 100 : 0) + "%"}}/></div></div>)}</div>
          </article>
          <article className="analytics-card"><div className="analytics-card-heading"><div><h3>Score distribution</h3><p>Validated numeric scores · completed interviews</p></div></div>
            <div className="decision-bars">{analytics.scoreBands.map((band: any, index: number) => <div className="decision-bar-row" key={band.label}><div><span>{band.label}</span><b>{band.count}</b></div><div className="decision-track"><i className={"score-band score-band-" + index} style={{width: (analytics.scoredCount ? band.count / analytics.scoredCount * 100 : 0) + "%"}}/></div></div>)}</div>
            <p className="analytics-footnote">Score bands are descriptive only and should not be used as automatic hiring cut-offs.</p>
          </article>
          <article className="analytics-card"><div className="analytics-card-heading"><div><h3>Top roles</h3><p>Roles with the most interview activity</p></div></div>
            {analytics.roles.length ? <div className="role-list">{analytics.roles.map((role: any) => <div className="role-row" key={role.role}><div><span>{role.role}</span><b>{role.count}</b></div><div className="decision-track"><i style={{width: role.share + "%"}}/></div></div>)}</div> : <p className="analytics-empty">Role activity will appear when interviews are created.</p>}
          </article>
        </div>
        <p className="analytics-disclaimer">Analytics describe recorded activity, not candidate quality. AI scores and recommendations are advisory; review interview evidence and apply consistent job-related criteria.</p>
      </>}
    </section>
    <section className="privacy-retention-card">
      <div className="analytics-heading"><div><div className="eyebrow">PRIVACY CONTROLS</div><h2>Data retention overview</h2><p>Read-only preview of completed interview records that meet the configured retention age.</p></div><span className="analytics-updated">Preview only · no data deleted</span></div>
      {retentionError && <div className="error-box">{retentionError}</div>}
      {retentionPreview && <>
        <div className="retention-kpis">
          <div><small>TOTAL RECORDS</small><strong>{retentionPreview.totalInterviews}</strong></div>
          <div><small>COMPLETED</small><strong>{retentionPreview.completedInterviews}</strong></div>
          <div><small>IN PROGRESS</small><strong>{retentionPreview.inProgressInterviews}</strong></div>
          <div><small>INVITED</small><strong>{retentionPreview.invitedInterviews}</strong></div>
          <div><small>ELIGIBLE FOR REVIEW</small><strong>{retentionPreview.eligibleCompletedInterviews}</strong></div>
        </div>
        <div className="retention-policy-note">
          {retentionPreview.configured
            ? <>Configured retention: <b>{retentionPreview.retentionDays} days</b> · cutoff: <b>{date(retentionPreview.cutoff)}</b></>
            : <>No valid retention policy is configured. Set <code>INTERVIEW_RETENTION_DAYS</code> on the server to enable eligibility previews.</>}
        </div>
        <div className="retention-policy-note">Consent metadata present: <b>{retentionPreview.consentedInterviews}</b> · Missing consent timestamp or version: <b>{retentionPreview.missingConsentMetadata}</b></div>
        <p className="analytics-disclaimer">This is an eligibility preview only: it never automatically deletes interviews, resumes, transcripts, reports or recordings. Separately verified and employer-approved deletion requests can be executed from the Candidate deletion requests queue below. Review applicable legal requirements and candidate notices before setting a retention period.</p>
      </>}
    </section>
    <section className="dashboard-table-card privacy-deletion-queue">
      <div className="table-heading"><div><div className="eyebrow">PRIVACY WORKFLOW</div><h2>Candidate deletion requests</h2><p>Candidate verification and employer approval are mandatory. Execute deletion only after reviewing the verified request.</p></div><span className="analytics-updated">Latest 100</span></div>
      {deletionQueueError && <div className="error-box">{deletionQueueError}</div>}
      {deletionQueueMessage && <div className="success-box">{deletionQueueMessage}</div>}
      {!deletionQueueError && <div className="table-scroll"><table><thead><tr><th>REQUESTED</th><th>CANDIDATE</th><th>ROLE</th><th>STATUS</th><th>WORKFLOW</th></tr></thead><tbody>
        {deletionRequests.map((request: any) => <tr key={request.id}>
          <td>{date(request.createdAt)}</td><td>
            {request.candidateNameSnapshot}
            <small className="audit-notes">{request.candidateEmailSnapshot || "No email recorded"}</small>
            <details style={{ marginTop: 8, fontSize: 11, maxWidth: 340, whiteSpace: "normal" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Reason &amp; audit history</summary>
              <div style={{ marginTop: 8, padding: 9, border: "1px solid #e3ebe4", borderRadius: 8, background: "#f8fbf8" }}>
                <b>Request reason</b>
                <p style={{ margin: "4px 0 10px", lineHeight: 1.5 }}>{request.reason || "No reason recorded."}</p>
                <b>Recent workflow events</b>
                {request.events?.length ? request.events.map((event: any) => <div key={event.id} style={{ padding: "8px 0", borderTop: "1px solid #e7eee8" }}>
                  <b style={{ textTransform: "capitalize" }}>{String(event.action).replaceAll("_", " ")}</b>
                  <small style={{ display: "block", color: "#879389" }}>{date(event.createdAt)} · {event.actor}</small>
                  {event.details && <p style={{ margin: "4px 0 0", lineHeight: 1.5, color: "#66766a" }}>{event.details}</p>}
                </div>) : <p>No audit events recorded.</p>}
                <small style={{ color: "#879389" }}>Showing the latest 10 events.</small>
              </div>
            </details>
          </td><td>{request.roleSnapshot}</td>
          <td>
            <span className="audit-decision audit-review">{request.status.replaceAll("_", " ")}</span>
            {request.status === "deletion_failed" && <small className="audit-notes" style={{ display: "block", marginTop: 6 }}>
              Last issue: {request.lastErrorCode || "DELETION_EXECUTION_FAILED"} · Attempts: {request.deletionAttempts || 0}
            </small>}
            {request.status === "deletion_in_progress" && request.executionStartedAt && <small className="audit-notes" style={{ display: "block", marginTop: 6 }}>
              Started: {date(request.executionStartedAt)} · Attempts: {request.deletionAttempts || 0}
              {request.executionLeaseExpired && <><br />Worker lease expired. Recovery is available.</>}
            </small>}
            {request.status === "deletion_completed" && request.completedAt && <small className="audit-notes" style={{ display: "block", marginTop: 6 }}>
              Completed: {date(request.completedAt)}
            </small>}
          </td>
          <td className="privacy-workflow-actions">
            {request.status === "pending_candidate_verification" && <button className="view-btn" disabled={!!deletionActionBusy} onClick={() => runDeletionAction(request.id, request.interviewId, "send")}>{deletionActionBusy === request.id + ":send" ? "Sending…" : "Send verification"}</button>}
            {request.status === "verified_pending_approval" && <button className="view-btn" disabled={!!deletionActionBusy} onClick={() => runDeletionAction(request.id, request.interviewId, "approve")}>{deletionActionBusy === request.id + ":approve" ? "Approving…" : "Approve request"}</button>}
            {request.status === "approved_for_deletion" && <button className="view-btn" disabled={!!deletionActionBusy} onClick={() => runDeletionAction(request.id, request.interviewId, "execute")}>{deletionActionBusy === request.id + ":execute" ? "Deleting…" : "Execute deletion"}</button>}
            {request.status === "deletion_failed" && <button className="view-btn" disabled={!!deletionActionBusy} onClick={() => runDeletionAction(request.id, request.interviewId, "execute")}>{deletionActionBusy === request.id + ":execute" ? "Retrying…" : "Retry deletion"}</button>}
            {request.status === "deletion_completed" && <span className="analytics-updated">Completed · anonymized receipt retained</span>}
            {request.status === "deletion_in_progress" && request.executionLeaseExpired && <button className="view-btn" disabled={!!deletionActionBusy} onClick={() => runDeletionAction(request.id, request.interviewId, "execute")}>{deletionActionBusy === request.id + ":execute" ? "Recovering…" : "Recover stalled deletion"}</button>}
            {request.status === "deletion_in_progress" && !request.executionLeaseExpired && <span className="analytics-updated">Processing · refresh to check status</span>}
          </td>
        </tr>)}
        {!deletionRequests.length && <tr><td colSpan={5} className="empty-cell">No candidate deletion requests have been created.</td></tr>}
      </tbody></table></div>}
      <p className="analytics-disclaimer">Verification links expire after 30 minutes. Completed requests remove the interview, transcript, report and private recording. A minimal anonymized receipt remains.</p>
    </section>
    <section className="dashboard-table-card audit-card">
      <div className="table-heading"><div><div className="eyebrow">ACCOUNTABILITY</div><h2>Decision audit history</h2><p>Latest 100 employer hiring decisions, with timestamps and recorded notes.</p></div><span className="analytics-updated">Newest first</span></div>
      {auditError && <div className="error-box">{auditError}</div>}
      {!auditError && <div className="table-scroll"><table><thead><tr><th>DATE & TIME</th><th>CANDIDATE</th><th>ROLE</th><th>DECISION</th><th>NOTES</th><th /></tr></thead><tbody>
        {auditEvents.map((event: any) => <tr key={event.id}><td>{date(event.createdAt)}</td><td>{event.interview.candidateName}</td><td>{event.interview.role}</td><td><span className={"audit-decision audit-" + event.decision}>{event.decision}</span></td><td className="audit-notes">{event.notes || "—"}</td><td><button className="view-btn" onClick={() => openDetail(event.interview.id)}>Review →</button></td></tr>)}
        {!auditEvents.length && <tr><td colSpan={6} className="empty-cell">Employer decisions will appear here after they are recorded.</td></tr>}
      </tbody></table></div>}
      <p className="analytics-disclaimer">This feed records hiring decisions and notes. It is not a complete security access log and does not record every page view or data access.</p>
    </section>
    {compared.length > 0 && <section className="dashboard-table-card"><div className="table-heading"><div><h2>Candidate comparison</h2><p>Compare up to three candidates side by side. AI scores are advisory, not hiring decisions.</p></div><button className="outline-btn" onClick={runEvidenceComparison} disabled={compareIds.length < 2 || comparisonBusy}>{comparisonBusy ? "Comparing…" : "Compare skill evidence"}</button><button className="outline-btn" onClick={() => { setCompareIds([]); setComparison(null); }}>Clear comparison</button></div><div className="table-scroll"><table><thead><tr><th>Measure</th>{compared.map(item=><th key={item.id}>{item.candidateName}<small> · {item.role}</small></th>)}</tr></thead><tbody>{([{label:"AI score",value:(item:Item)=>item.overallScore === null ? "—" : `${item.overallScore}/100`},{label:"AI recommendation",value:(item:Item)=>item.recommendation || "—"},{label:"Employer decision",value:(item:Item)=>item.employerDecision || "Pending"},{label:"Interview status",value:(item:Item)=>item.status},{label:"Interview mode",value:(item:Item)=>item.mode},{label:"Duration",value:(item:Item)=>`${Math.floor(item.durationSeconds/60)}m ${item.durationSeconds%60}s`}]).map(metric=><tr key={metric.label}><th>{metric.label}</th>{compared.map(item=><td key={item.id}>{metric.value(item)}</td>)}</tr>)}</tbody></table></div>
      {comparison && <div className="evidence-comparison">
        <h3>Skill evidence comparison</h3>
        <p>{comparison.comparisonNote}</p>
        <div className="table-scroll"><table><thead><tr><th>Job-related skill</th>{comparison.candidates.map((candidate: any) => <th key={candidate.id}>{candidate.candidateName}<small> · {candidate.role}</small></th>)}</tr></thead>
          <tbody>{comparison.skills.map((skill: any) => <tr key={skill.skill}><th>{skill.skill}</th>{skill.candidates.map((item: any) => <td key={item.candidateId}><b>{item.rating}</b><small className="evidence-quote">{item.evidence}</small></td>)}</tr>)}</tbody>
        </table></div>
        <p className="drawer-sub">Scores and AI recommendations remain advisory. Missing evidence is not proof that a candidate lacks the skill.</p>
      </div>}
    </section>}
    <section className="dashboard-table-card"><div className="table-heading"><div><h2>Candidate interviews</h2><p>Open an interview to review its transcript and report.</p></div><div className="header-actions"><input className="search-input" placeholder="Search loaded candidates…" value={query} onChange={e=>setQuery(e.target.value)} /><button className="outline-btn" onClick={exportCsv} disabled={!items.length}>Export CSV</button></div></div>
      {error && <div className="error-box">{error}</div>}
      <div className="table-scroll"><table><thead><tr><th>COMPARE / CANDIDATE</th><th>ROLE</th><th>FORMAT</th><th>STATUS</th><th>SCORE</th><th>DATE</th><th /></tr></thead><tbody>
      {filtered.map(x=><tr key={x.id}><td><label className="compare-select"><input type="checkbox" checked={compareIds.includes(x.id)} disabled={x.status !== "completed" || (!compareIds.includes(x.id) && compareIds.length >= 3)} onChange={() => toggleCompare(x.id)} aria-label={x.status === "completed" ? `Compare ${x.candidateName}` : `${x.candidateName} is not completed yet`} title={x.status === "completed" ? "Select for evidence comparison" : "Only completed interviews can be compared"} /><b>{x.candidateName}</b></label></td><td>{x.role}</td><td>{x.mode}</td><td><span className={x.status==="completed"?"status-complete":"status-progress"}>{x.status}</span></td><td>{x.overallScore===null?"—":`${x.overallScore}/100`}</td><td>{date(x.createdAt)}</td><td><button className="view-btn" onClick={()=>openDetail(x.id)}>Review →</button></td></tr>)}
      {!filtered.length && <tr><td colSpan={7} className="empty-cell">No interviews found yet. Create your first interview from the New interview button.</td></tr>}
      </tbody></table></div>
      <div className="table-heading"><p className="analytics-updated">Showing {items.length} loaded interviews{hasMore ? " · more available" : " · all interviews loaded"}. Search and CSV export apply to loaded interviews.</p>{hasMore && <button className="outline-btn" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load 100 more"}</button>}</div>
    </section>
    {selected && <div className="detail-backdrop" onClick={closeDetail}><section className="detail-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={closeDetail}>×</button><div className="eyebrow">CANDIDATE REVIEW</div><h2>{selected.candidateName}</h2><p className="drawer-sub">{selected.role} · {selected.mode} interview</p>{selected.status === "completed" && selected.reportJson ? <a className="outline-btn" href={`/api/sessions/${selected.id}/export`}>Download full interview report CSV ↓</a> : <p className="drawer-sub">CSV export is available after the interview report is completed.</p>}
      {selected.status === "invited" && <div className="privacy-deletion-request"><div className="eyebrow">CANDIDATE INVITATION</div><h3>Replacement invitation link</h3><p>Use this if the original link expired or was lost. Creating a replacement invalidates the previous link. This is available only before the candidate opens the invitation.</p>{inviteReissueError && <div className="error-box">{inviteReissueError}</div>}{replacementInviteUrl ? <><input aria-label="Replacement candidate invitation link" readOnly value={replacementInviteUrl}/><button className="outline-btn" onClick={async()=>{try{await navigator.clipboard.writeText(replacementInviteUrl);}catch{setInviteReissueError("Could not copy automatically. Select and copy the invitation link manually.");}}}>Copy replacement link</button></> : <button className="outline-btn" disabled={inviteReissueBusy} onClick={()=>void reissueInvitation()}>{inviteReissueBusy ? "Creating replacement link…" : "Generate replacement invitation"}</button>}</div>}
      {selected.reportJson ? <ReportView json={selected.reportJson}/> : <p className="drawer-sub">No completed report is available for this interview.</p>}
      <div className="employer-decision"><div className="eyebrow">EMPLOYER DECISION</div><p>AI recommendation is advisory. Record your independent hiring decision.</p>{selected.status === "completed" ? <><textarea rows={3} maxLength={3000} value={decisionNotes} onChange={e=>setDecisionNotes(e.target.value)} placeholder="Optional notes for the hiring team…" /><div className="decision-actions"><button disabled={decisionBusy} onClick={()=>saveDecision("shortlist")}>Shortlist</button><button disabled={decisionBusy} onClick={()=>saveDecision("review")}>Needs review</button><button disabled={decisionBusy} onClick={()=>saveDecision("reject")}>Reject</button></div></> : <p className="drawer-sub">Hiring decisions become available after the interview is completed.</p>}{selected.employerDecision && <small>Current decision: <b>{selected.employerDecision}</b>{selected.decisionAt ? ` · ${date(selected.decisionAt)}` : ""}</small>}{selected.decisionHistory?.length > 0 && <div className="decision-history"><b>Decision history</b>{selected.decisionHistory.map(item=><div key={item.id}><span>{item.decision}</span><small>{date(item.createdAt)}</small>{item.notes && <p>{item.notes}</p>}</div>)}</div>}</div>
      {selected.status === "completed" && <div className="privacy-deletion-request">
        <div className="eyebrow">PRIVACY MANAGEMENT</div>
        <h3>Request candidate data deletion</h3>
        <p>This creates a tracked request only. It does not delete the candidate profile, resume, transcript, report or recording. Candidate verification and a separate approval workflow are required before any deletion.</p>
        <label>Reason for request<textarea rows={3} value={deletionReason} onChange={e=>setDeletionReason(e.target.value)} placeholder="Explain the candidate request or applicable retention reason (10–1000 characters)." /></label>
        <label>Type REQUEST DELETION to confirm<input value={deletionConfirmation} onChange={e=>setDeletionConfirmation(e.target.value)} placeholder="REQUEST DELETION" /></label>
        {deletionError && <div className="error-box">{deletionError}</div>}
        {deletionMessage && <div className="success-box">{deletionMessage}</div>}
        <button className="outline-btn" disabled={deletionBusy || deletionConfirmation !== "REQUEST DELETION" || deletionReason.trim().length < 10} onClick={createDeletionRequest}>{deletionBusy ? "Submitting…" : "Create deletion request"}</button>
      </div>}
      {selected.mode === "live" && selected.status !== "completed" && <div className="drawer-live-call"><h3>Live interview room</h3><p>{liveCallState}</p><video ref={employerVideoRef} autoPlay playsInline /><div className="employer-self-preview"><video ref={employerLocalRef} autoPlay muted playsInline /><span>Your camera</span></div><small>Keep this review panel open while the candidate joins. Browser camera and microphone permission is required.</small><div className="decision-actions"><button className="outline-btn" onClick={() => setLiveCallAttempt(value => value + 1)}>Reconnect live video</button><button className="outline-btn" onClick={() => void endLiveCall()}>End live connection</button></div></div>}{selected.hasRecording && <RecordingPlayer src={`/api/sessions/${selected.id}/recording`} candidateName={selected.candidateName} />}<h3>Interview transcript</h3><div className="drawer-transcript">{selected.messages.map((m,i)=><div key={i} className="drawer-message"><small>{m.role==="assistant"?"AI INTERVIEWER":"CANDIDATE"}</small><p>{m.content}</p></div>)}</div>
    </section></div>}
  </main>;
}

function ReportView({json}:{json:string}) {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return <p>Report data could not be read.</p>; }
  if (!isRestorableInterviewReport(parsed)) {
    return <p>Report data failed validation and cannot be displayed as a verified assessment. Please retry report recovery or contact the administrator.</p>;
  }
  const report = parsed as Record<string, unknown>;
  const text = (value: unknown, fallback = "—") => typeof value === "string" && value.trim() ? value : fallback;
  const list = (value: unknown) => Array.isArray(value) ? value : [];
  const strengths = list(report.strengths).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const improvementAreas = list(report.improvementAreas).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const skills = list(report.skills).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  const questionFeedback = list(report.questionFeedback).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  const supportedSkillCount = skills.filter(item =>
    typeof item.evidence === "string" && item.evidence !== "Insufficient evidence" && item.evidence.trim().length >= 8
  ).length;
  const evidenceCoverage = skills.length ? Math.round((supportedSkillCount / skills.length) * 100) : 0;
  const score = Number.isInteger(report.overallScore) && Number(report.overallScore) >= 0 && Number(report.overallScore) <= 100
    ? Number(report.overallScore)
    : "—";
  return <div className="drawer-report">
    <div className="drawer-score"><strong>{score}</strong><span>/100 · {text(report.recommendation, "Needs review")}</span></div>
    <p className="drawer-sub">Evidence coverage: <b>{evidenceCoverage}%</b> ({supportedSkillCount} of {skills.length} assessed skills have a supporting candidate-answer quote). Missing evidence is not proof that a candidate lacks the skill.</p>
    <p>{text(report.summary, "No report summary is available.")}</p>
    <h3>Strengths</h3>
    {strengths.length ? <ul>{strengths.map((item,i)=><li key={i}>{item}</li>)}</ul> : <p>No strengths were recorded.</p>}
    <h3>Development areas</h3>
    {improvementAreas.length ? <ul>{improvementAreas.map((item,i)=><li key={i}>{item}</li>)}</ul> : <p>No development areas were recorded.</p>}
    <h3>Skill assessment</h3>
    {skills.length ? skills.map((item,i)=><div className="drawer-skill" key={i}><b>{text(item.skill, "Unnamed skill")}</b><span>{text(item.rating, "Insufficient evidence")}</span><p>{text(item.evidence, "Insufficient evidence")}</p></div>) : <p>No skill assessments were recorded.</p>}
    <h3>Question-by-question evidence</h3>
    {questionFeedback.length ? questionFeedback.map((item,i)=><div className="drawer-skill" key={i}><b>Q{i+1}. {text(item.question, "Question unavailable")}</b><p>{text(item.assessment, "No assessment was recorded.")}</p><small>Evidence: {text(item.evidence, "Insufficient evidence")}</small></div>) : <p>No question-level feedback was recorded.</p>}
    {typeof report.disclaimer === "string" && report.disclaimer.trim() && <p className="drawer-sub">{report.disclaimer}</p>}
  </div>;
}
