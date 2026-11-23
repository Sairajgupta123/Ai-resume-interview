"use client";

import { useState } from "react";

export default function NewInterview() {
  const [candidateName,setCandidateName]=useState("");
  const [candidateEmail,setCandidateEmail]=useState("");
  const [role,setRole]=useState("");
  const [resume,setResume]=useState("");
  const [jobDescription,setJobDescription]=useState("");
  const [mode,setMode]=useState("live");
  const [inviteUrl,setInviteUrl]=useState("");
  const [copied,setCopied]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const create=async(e:React.FormEvent)=>{
    e.preventDefault();setBusy(true);setError("");setInviteUrl("");
    try {
      const response=await fetch("/api/employer/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({candidateName,candidateEmail,role,resume,jobDescription,mode})});
      const data:unknown=await response.json();
      if(!response.ok) {
        const message=data&&typeof data==="object"&&"error" in data&&typeof data.error==="string"?data.error:"Could not create interview.";
        throw new Error(message);
      }
      if(!data||typeof data!=="object"||!("id" in data)||typeof data.id!=="string"||!("inviteUrl" in data)||typeof data.inviteUrl!=="string") {
        throw new Error("The interview was created, but the invitation link could not be confirmed. Refresh the dashboard before retrying.");
      }
      setInviteUrl(data.inviteUrl);
    } catch(e){setError(e instanceof Error?e.message:"Something went wrong.");}
    finally{setBusy(false);}
  };
  return <main className="dashboard-shell">
    <header className="dashboard-header"><a className="brand" href="/dashboard"><span className="brand-mark">M</span><span>mzobs<span className="brand-dot">.</span><small>EMPLOYER WORKSPACE</small></span></a><a className="back-link" href="/dashboard">← Dashboard</a></header>
    <section className="new-interview-card">
      <div className="eyebrow">CANDIDATE INVITATION</div><h1>Create an <em>interview.</em></h1><p>Prepare the role context and create a private invitation link for the candidate. The link expires in 72 hours.</p>
      <form onSubmit={create} className="new-interview-form">
        <label>Candidate name<input required value={candidateName} onChange={e=>setCandidateName(e.target.value)} placeholder="Candidate full name"/></label>
        <label>Candidate email<input required type="email" value={candidateEmail} onChange={e=>setCandidateEmail(e.target.value)} placeholder="candidate@example.com"/></label>
        <label className="wide">Job role<input required value={role} onChange={e=>setRole(e.target.value)} placeholder="e.g. Backend Developer"/></label>
        <label className="wide">Candidate resume<textarea required rows={6} value={resume} onChange={e=>setResume(e.target.value)} placeholder="Paste resume text, skills, experience and projects..."/></label>
        <label className="wide">Job description<textarea required rows={6} value={jobDescription} onChange={e=>setJobDescription(e.target.value)} placeholder="Paste responsibilities and required skills..."/></label>
        <label className="wide">Interview format<select value={mode} onChange={e=>setMode(e.target.value)}><option value="live">Live voice and video</option><option value="recorded">Recorded interview</option></select></label>
        {error&&<p className="error-box wide">{error}</p>}
        <button className="primary-btn wide" disabled={busy}>{busy?"Creating invitation…":"Create interview invitation ↗"}</button>
      </form>
      {inviteUrl&&<div className="invite-result"><b>Invitation link created</b><p>Copy this private link and send it to the candidate. The candidate email is recorded for your reference; this app does not send email automatically.</p><input readOnly value={inviteUrl}/><button className="primary-btn" onClick={async()=>{try{await navigator.clipboard.writeText(inviteUrl);setCopied(true);}catch{setError("Could not copy automatically. Select and copy the invitation link manually.");}}}>{copied?"Link copied ✓":"Copy invitation link"}</button></div>}
    </section>
  </main>;
}
