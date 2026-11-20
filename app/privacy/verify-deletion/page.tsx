"use client";

import { useEffect, useState } from "react";
import { clearCachedRecording } from "@/lib/recording-cache";

export default function VerifyDeletionPage() {
  const [token, setToken] = useState("");
  const [requestId, setRequestId] = useState("");
  const [linkReady, setLinkReady] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") || "");
    setRequestId(params.get("request") || "");

    // Keep the one-time credential in component memory, not in the visible URL
    // or subsequent same-tab navigation history.
    window.history.replaceState(null, "", window.location.pathname);
    setLinkReady(true);
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const verify = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/privacy/deletion-verification", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, requestId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Verification could not be completed. Please try again.");
      let localNote = " If this is the same browser used for the interview, its locally cached recording segments were also cleared.";
      if (data.localRecordingSessionId) {
        try { await clearCachedRecording(data.localRecordingSessionId); }
        catch { localNote = " Local browser recording cache could not be reached from this device; clear the interview browser data on the original device if it is still present."; }
      }
      setMessage((data.message || "Your request has been verified.") + localNote);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Verification failed.");
    } finally { setBusy(false); }
  };
  return <main className="privacy-verify-page">
    <section className="privacy-verify-card">
      <div className="eyebrow">MZOBS · PRIVACY CENTER</div>
      <h1>Verify your deletion request</h1>
      <p>Confirm that you control the email address that received this link. This step verifies your request only; it does not immediately delete interview data.</p>
      {!linkReady && <p role="status" aria-live="polite">Checking verification link…</p>}
      {linkReady && !token && <div className="error-box" role="alert">This verification link is incomplete or missing its token. Please open the complete link from your email.</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      {message && <div className="success-box" role="status" aria-live="polite">{message}</div>}
      {!message && <button type="button" disabled={!linkReady || !token || busy} onClick={verify}>{busy ? "Verifying…" : "Confirm my request"}</button>}
      {linkReady && !message && <small>If the link has expired or was already used, contact the hiring organization. They can check the request status or send a fresh link if verification is still pending.</small>}
      {message && <small>This link can be used only once. The hiring organization must separately approve the request before deletion can proceed.</small>}
    </section>
    <style jsx>{`
      .privacy-verify-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f8f5;color:#263b2d;font-family:Arial,sans-serif}
      .privacy-verify-card{width:min(100%,480px);padding:32px;background:#fff;border:1px solid #e1e9e2;border-radius:16px;box-shadow:0 16px 50px #193c2510}
      .eyebrow{font-size:10px;letter-spacing:1.6px;font-weight:800;color:#6b8972}
      h1{font-size:26px;line-height:1.2;margin:14px 0}
      p{font-size:14px;line-height:1.7;color:#68776c}
      button{margin-top:18px;padding:12px 18px;border:0;border-radius:8px;background:#28563a;color:#fff;font-weight:700;cursor:pointer}
      button:disabled{opacity:.5;cursor:not-allowed}
      small{display:block;margin-top:18px;color:#89958c;font-size:11px}
      :global(.error-box),:global(.success-box){margin-top:14px;padding:12px;border-radius:8px;font-size:12px;line-height:1.5}
      :global(.error-box){background:#fbefed;color:#984b43}
      :global(.success-box){background:#edf6ef;color:#28613d}
    `}</style>
  </main>;
}
