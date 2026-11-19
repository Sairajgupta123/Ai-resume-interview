"use client";

import { useEffect, useState } from "react";

type Item = { id: string; candidateName: string; role: string; mode: string; status: string; overallScore: number | null; recommendation: string | null; durationSeconds: number; createdAt: string };
type Detail = Item & { resumeText: string; jobDescription: string; recordingPath: string | null; reportJson: string | null; messages: { role: string; content: string }[] };

export default function Dashboard() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");

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
    if (r.ok) setSelected(d.interview);
    else setError(d.error || "Could not load interview.");
  };

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); setAuthenticated(false); setSelected(null); };
  const filtered = items.filter(x => `${x.candidateName} ${x.role}`.toLowerCase().includes(query.toLowerCase()));
  const date = (v: string) => new Date(v).toLocaleString();

  if (checking) return <main className="dashboard-shell"><p>Loading secure dashboard…</p></main>;
  if (!authenticated) return <main className="login-shell"><form className="login-card" onSubmit={login}><a className="brand" href="/"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>EMPLOYER WORKSPACE</small></span></a><div className="eyebrow">SECURE ACCESS</div><h1>Welcome back.</h1><p>Sign in to review candidate interviews and AI-generated evidence.</p><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div className="error-box">{error}</div>}<button className="primary-btn">Sign in <span>↗</span></button><a className="back-link" href="/">← Back to interview setup</a></form></main>;

  return <main className="dashboard-shell">
    <header className="dashboard-header"><a className="brand" href="/"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>EMPLOYER WORKSPACE</small></span></a><div className="header-actions"><span className="secure"><i/> Signed in</span><button className="outline-btn" onClick={logout}>Sign out</button></div></header>
    <section className="dashboard-title"><div><div className="eyebrow">HIRING INTELLIGENCE</div><h1>Interview <em>overview.</em></h1><p>Review candidate conversations, role alignment and evidence-backed AI reports.</p></div><a className="primary-link" href="/">＋ New interview</a></section>
    <div className="metric-row"><div className="metric"><small>TOTAL INTERVIEWS</small><strong>{items.length}</strong></div><div className="metric"><small>COMPLETED</small><strong>{items.filter(x=>x.status==="completed").length}</strong></div><div className="metric"><small>AVERAGE SCORE</small><strong>{items.filter(x=>x.overallScore!==null).length ? Math.round(items.reduce((a,x)=>a+(x.overallScore||0),0)/items.filter(x=>x.overallScore!==null).length) : "—"}</strong></div></div>
    <section className="dashboard-table-card"><div className="table-heading"><div><h2>Candidate interviews</h2><p>Open an interview to review its transcript and report.</p></div><input className="search-input" placeholder="Search candidate or role…" value={query} onChange={e=>setQuery(e.target.value)} /></div>
      {error && <div className="error-box">{error}</div>}
      <div className="table-scroll"><table><thead><tr><th>CANDIDATE</th><th>ROLE</th><th>FORMAT</th><th>STATUS</th><th>SCORE</th><th>DATE</th><th /></tr></thead><tbody>
      {filtered.map(x=><tr key={x.id}><td><b>{x.candidateName}</b></td><td>{x.role}</td><td>{x.mode}</td><td><span className={x.status==="completed"?"status-complete":"status-progress"}>{x.status}</span></td><td>{x.overallScore===null?"—":`${x.overallScore}/100`}</td><td>{date(x.createdAt)}</td><td><button className="view-btn" onClick={()=>openDetail(x.id)}>Review →</button></td></tr>)}
      {!filtered.length && <tr><td colSpan={7} className="empty-cell">No interviews found yet. Create your first interview from the New interview button.</td></tr>}
      </tbody></table></div>
    </section>
    {selected && <div className="detail-backdrop" onClick={()=>setSelected(null)}><section className="detail-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)}>×</button><div className="eyebrow">CANDIDATE REVIEW</div><h2>{selected.candidateName}</h2><p className="drawer-sub">{selected.role} · {selected.mode} interview</p>
      {selected.reportJson ? <ReportView json={selected.reportJson}/> : <p className="drawer-sub">No completed report is available for this interview.</p>}
      {selected.recordingPath && <div className="drawer-video"><h3>Candidate video recording</h3><video controls playsInline src={`/api/sessions/${selected.id}/recording`} /></div>}<h3>Interview transcript</h3><div className="drawer-transcript">{selected.messages.map((m,i)=><div key={i} className="drawer-message"><small>{m.role==="assistant"?"AI INTERVIEWER":"CANDIDATE"}</small><p>{m.content}</p></div>)}</div>
    </section></div>}
  </main>;
}

function ReportView({json}:{json:string}) {
  let report: any = {};
  try { report = JSON.parse(json); } catch { return <p>Report data could not be read.</p>; }
  return <div className="drawer-report"><div className="drawer-score"><strong>{report.overallScore ?? "—"}</strong><span>/100 · {report.recommendation || "Needs review"}</span></div><p>{report.summary}</p><h3>Strengths</h3><ul>{(report.strengths||[]).map((x:string,i:number)=><li key={i}>{x}</li>)}</ul><h3>Development areas</h3><ul>{(report.improvementAreas||[]).map((x:string,i:number)=><li key={i}>{x}</li>)}</ul><h3>Skill assessment</h3>{(report.skills||[]).map((x:any,i:number)=><div className="drawer-skill" key={i}><b>{x.skill}</b><span>{x.rating}</span><p>{x.evidence}</p></div>)}</div>;
}
