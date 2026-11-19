"use client";

import { useEffect } from "react";

export default function CandidateInviteRedirect() {
  useEffect(() => {
    const id = window.location.pathname.split("/").filter(Boolean).pop();
    const token = new URLSearchParams(window.location.search).get("token");
    if (!id || !token) { window.location.replace("/"); return; }
    window.location.replace(`/?candidateInterviewId=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`);
  }, []);
  return <main className="dashboard-shell"><p>Opening your secure interview invitation…</p></main>;
}
