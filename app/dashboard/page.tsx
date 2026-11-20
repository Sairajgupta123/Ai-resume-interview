"use client";

import { useEffect, useRef, useState } from "react";
import { buildCsv } from "@/lib/csv-export.mjs";
import RecordingPlayer from "./recording-player";

type Item = { id: string; candidateName: string; role: string; mode: string; status: string; overallScore: number | null; recommendation: string | null; employerDecision: string | null; durationSeconds: number; createdAt: string };
type Detail = Item & { resumeText: string; jobDescription: string; recordingPath: string | null; reportJson: string | null; employerNotes: string | null; decisionAt: string | null; decisionHistory: { id: string; decision: string; notes: string | null; createdAt: string }[]; messages: { role: string; content: string }[] };

export default function Dashboard() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<any | null>(null);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const employerVideoRef = useRef<HTMLVideoElement>(null);
  const employerLocalRef = useRef<HTMLVideoElement>(null);
  const [liveCallState, setLiveCallState] = useState("Waiting for candidate…");

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
    const pendingIce: RTCIceCandidateInit[] = [];
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
        peer.ontrack = event => {
          if (employerVideoRef.current) employerVideoRef.current.srcObject = event.streams[0];
          setLiveCallState("Connected · live video and audio");
        };
        peer.onconnectionstatechange = () => {
          if (peer?.connectionState === "connecting") setLiveCallState("Connecting to candidate…");
          if (peer?.connectionState === "failed") setLiveCallState("Connection failed. Check TURN server configuration.");
          if (peer?.connectionState === "disconnected") setLiveCallState("Candidate connection interrupted.");
        };
        peer.onicecandidate = event => {
          if (event.candidate && !stopped) void postSignal("ice", JSON.stringify(event.candidate.toJSON()));
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
            for (const signal of data.signals || []) {
              cursor = signal.createdAt;
              cursorId = signal.id;
              if (signal.kind === "offer" && peer!.signalingState === "stable") {
                await peer!.setRemoteDescription(JSON.parse(signal.payload));
                for (const candidate of pendingIce.splice(0)) await peer!.addIceCandidate(candidate).catch(() => {});
                const answer = await peer!.createAnswer();
                await peer!.setLocalDescription(answer);
                await postSignal("answer", JSON.stringify(peer!.localDescription));
                setLiveCallState("Answer sent · connecting…");
              } else if (signal.kind === "ice") {
                const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
                if (peer!.remoteDescription) await peer!.addIceCandidate(candidate).catch(() => {});
                else pendingIce.push(candidate);
              } else if (signal.kind === "hangup") {
                setLiveCallState("Candidate ended the call.");
                peer!.close();
              }
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
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
      peer?.close();
      localStream?.getTracks().forEach(track => track.stop());
      if (employerVideoRef.current) employerVideoRef.current.srcObject = null;
      if (employerLocalRef.current) employerLocalRef.current.srcObject = null;
    };
  }, [authenticated, selected?.id, selected?.mode, selected?.status]);

  const load = async () => {
    const r = await fetch("/api/sessions", { cache: "no-store" });
    if (r.status === 401) { setAuthenticated(false); return; }
    const data = await r.json();
    setItems(data.interviews || []);
    setAuthenticated(true);
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
    const r = await fetch(`/api/sessions/${id}`);
    const d = await r.json();
    if (r.ok) { setSelected(d.interview); setDecisionNotes(d.interview.employerNotes || ""); }
    else setError(d.error || "Could not load interview.");
  };

  const saveDecision = async (decision: "shortlist" | "review" | "reject") => {
    if (!selected || decisionBusy) return;
    setDecisionBusy(true); setError("");
    try {
      const r = await fetch(`/api/sessions/${selected.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, notes: decisionNotes }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not save decision.");
      setSelected({ ...selected, employerDecision: data.decision, employerNotes: data.notes, decisionAt: data.decisionAt });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save decision."); }
    finally { setDecisionBusy(false); }
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); setAuthenticated(false); setSelected(null); };
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
  const exportCsv = () => {
    const columns = ["Candidate", "Role", "Mode", "Status", "AI score", "AI recommendation", "Employer decision", "Duration seconds", "Created at"];
    const rows = items.map(item => [item.candidateName, item.role, item.mode, item.status, item.overallScore ?? "", item.recommendation ?? "", item.employerDecision ?? "", item.durationSeconds, item.createdAt]);
    const csv = buildCsv(columns, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "mzobs-interview-candidates.csv"; link.click();
    URL.revokeObjectURL(url);
  };
  const date = (v: string) => new Date(v).toLocaleString();

  if (checking) return <main className="dashboard-shell"><p>Loading secure dashboard…</p></main>;
  if (!authenticated) return <main className="login-shell"><form className="login-card" onSubmit={login}><a className="brand" href="/"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>EMPLOYER WORKSPACE</small></span></a><div className="eyebrow">SECURE ACCESS</div><h1>Welcome back.</h1><p>Sign in to review candidate interviews and AI-generated evidence.</p><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div className="error-box">{error}</div>}<button className="primary-btn">Sign in <span>↗</span></button><a className="back-link" href="/">← Back to interview setup</a></form></main>;

  return <main className="dashboard-shell">
    <header className="dashboard-header"><a className="brand" href="/"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>EMPLOYER WORKSPACE</small></span></a><div className="header-actions"><span className="secure"><i/> Signed in</span><button className="outline-btn" onClick={logout}>Sign out</button></div></header>
    <section className="dashboard-title"><div><div className="eyebrow">HIRING INTELLIGENCE</div><h1>Interview <em>overview.</em></h1><p>Review candidate conversations, role alignment and evidence-backed AI reports.</p></div><a className="primary-link" href="/dashboard/new">＋ Invite candidate</a></section>
    <div className="metric-row"><div className="metric"><small>TOTAL INTERVIEWS</small><strong>{items.length}</strong></div><div className="metric"><small>COMPLETED</small><strong>{items.filter(x=>x.status==="completed").length}</strong></div><div className="metric"><small>AVERAGE SCORE</small><strong>{items.filter(x=>x.overallScore!==null).length ? Math.round(items.reduce((a,x)=>a+(x.overallScore||0),0)/items.filter(x=>x.overallScore!==null).length) : "—"}</strong></div></div>
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
    <section className="dashboard-table-card"><div className="table-heading"><div><h2>Candidate interviews</h2><p>Open an interview to review its transcript and report.</p></div><div className="header-actions"><input className="search-input" placeholder="Search candidate or role…" value={query} onChange={e=>setQuery(e.target.value)} /><button className="outline-btn" onClick={exportCsv} disabled={!items.length}>Export CSV</button></div></div>
      {error && <div className="error-box">{error}</div>}
      <div className="table-scroll"><table><thead><tr><th>COMPARE / CANDIDATE</th><th>ROLE</th><th>FORMAT</th><th>STATUS</th><th>SCORE</th><th>DATE</th><th /></tr></thead><tbody>
      {filtered.map(x=><tr key={x.id}><td><label className="compare-select"><input type="checkbox" checked={compareIds.includes(x.id)} disabled={!compareIds.includes(x.id) && compareIds.length >= 3} onChange={() => toggleCompare(x.id)} /><b>{x.candidateName}</b></label></td><td>{x.role}</td><td>{x.mode}</td><td><span className={x.status==="completed"?"status-complete":"status-progress"}>{x.status}</span></td><td>{x.overallScore===null?"—":`${x.overallScore}/100`}</td><td>{date(x.createdAt)}</td><td><button className="view-btn" onClick={()=>openDetail(x.id)}>Review →</button></td></tr>)}
      {!filtered.length && <tr><td colSpan={7} className="empty-cell">No interviews found yet. Create your first interview from the New interview button.</td></tr>}
      </tbody></table></div>
    </section>
    {selected && <div className="detail-backdrop" onClick={()=>setSelected(null)}><section className="detail-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)}>×</button><div className="eyebrow">CANDIDATE REVIEW</div><h2>{selected.candidateName}</h2><p className="drawer-sub">{selected.role} · {selected.mode} interview</p><a className="outline-btn" href={`/api/sessions/${selected.id}/export`}>Download full interview report CSV ↓</a>
      {selected.reportJson ? <ReportView json={selected.reportJson}/> : <p className="drawer-sub">No completed report is available for this interview.</p>}
      <div className="employer-decision"><div className="eyebrow">EMPLOYER DECISION</div><p>AI recommendation is advisory. Record your independent hiring decision.</p><textarea rows={3} value={decisionNotes} onChange={e=>setDecisionNotes(e.target.value)} placeholder="Optional notes for the hiring team…" /><div className="decision-actions"><button disabled={decisionBusy} onClick={()=>saveDecision("shortlist")}>Shortlist</button><button disabled={decisionBusy} onClick={()=>saveDecision("review")}>Needs review</button><button disabled={decisionBusy} onClick={()=>saveDecision("reject")}>Reject</button></div>{selected.employerDecision && <small>Current decision: <b>{selected.employerDecision}</b>{selected.decisionAt ? ` · ${date(selected.decisionAt)}` : ""}</small>}{selected.decisionHistory?.length > 0 && <div className="decision-history"><b>Decision history</b>{selected.decisionHistory.map(item=><div key={item.id}><span>{item.decision}</span><small>{date(item.createdAt)}</small>{item.notes && <p>{item.notes}</p>}</div>)}</div>}</div>
      {selected.mode === "live" && selected.status !== "completed" && <div className="drawer-live-call"><h3>Live interview room</h3><p>{liveCallState}</p><video ref={employerVideoRef} autoPlay playsInline /><div className="employer-self-preview"><video ref={employerLocalRef} autoPlay muted playsInline /><span>Your camera</span></div><small>Keep this review panel open while the candidate joins. Browser camera and microphone permission is required.</small></div>}{selected.recordingPath && <RecordingPlayer src={`/api/sessions/${selected.id}/recording`} candidateName={selected.candidateName} />}<h3>Interview transcript</h3><div className="drawer-transcript">{selected.messages.map((m,i)=><div key={i} className="drawer-message"><small>{m.role==="assistant"?"AI INTERVIEWER":"CANDIDATE"}</small><p>{m.content}</p></div>)}</div>
    </section></div>}
  </main>;
}

function ReportView({json}:{json:string}) {
  let report: any = {};
  try { report = JSON.parse(json); } catch { return <p>Report data could not be read.</p>; }
  return <div className="drawer-report"><div className="drawer-score"><strong>{report.overallScore ?? "—"}</strong><span>/100 · {report.recommendation || "Needs review"}</span></div><p>{report.summary}</p><h3>Strengths</h3><ul>{(report.strengths||[]).map((x:string,i:number)=><li key={i}>{x}</li>)}</ul><h3>Development areas</h3><ul>{(report.improvementAreas||[]).map((x:string,i:number)=><li key={i}>{x}</li>)}</ul><h3>Skill assessment</h3>{(report.skills||[]).map((x:any,i:number)=><div className="drawer-skill" key={i}><b>{x.skill}</b><span>{x.rating}</span><p>{x.evidence}</p></div>)}<h3>Question-by-question evidence</h3>{(report.questionFeedback||[]).map((x:any,i:number)=><div className="drawer-skill" key={i}><b>Q{i+1}. {x.question}</b><p>{x.assessment}</p><small>Evidence: {x.evidence}</small></div>)}</div>;
}
