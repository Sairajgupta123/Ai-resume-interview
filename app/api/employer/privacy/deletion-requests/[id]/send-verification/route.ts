import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { createDeletionVerificationToken, hashDeletionVerificationToken, DELETION_VERIFICATION_TTL_MS } from "@/lib/deletion-verification-policy.mjs";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  const interview = await db.interview.findUnique({ where: { id }, select: { id: true, candidateEmail: true } });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (!interview.candidateEmail) return NextResponse.json({ error: "A verified candidate email is not available for this interview. Do not verify identity using name alone." }, { status: 409 });

  const deletion = await db.privacyDeletionRequest.findUnique({ where: { interviewId: id } });
  if (!deletion || deletion.status !== "pending_candidate_verification") return NextResponse.json({ error: "No pending candidate verification request exists." }, { status: 409 });
  if (!process.env.RESEND_API_KEY || !process.env.PRIVACY_FROM_EMAIL || !process.env.NEXT_PUBLIC_APP_URL) {
    return NextResponse.json({ error: "Candidate verification email is not configured. Set RESEND_API_KEY, PRIVACY_FROM_EMAIL and NEXT_PUBLIC_APP_URL." }, { status: 503 });
  }

  const token = createDeletionVerificationToken();
  const expiresAt = new Date(Date.now() + DELETION_VERIFICATION_TTL_MS);
  const updated = await db.privacyDeletionRequest.updateMany({
    where: { id: deletion.id, status: "pending_candidate_verification" },
    data: {
      verificationTokenHash: hashDeletionVerificationToken(token),
      verificationExpiresAt: expiresAt,
      verificationSentAt: new Date(),
      verificationAttempts: 0
    }
  });
  if (updated.count !== 1) return NextResponse.json({ error: "Deletion request changed. Refresh and try again." }, { status: 409 });

  const verifyUrl = new URL("/privacy/verify-deletion", process.env.NEXT_PUBLIC_APP_URL);
  verifyUrl.searchParams.set("token", token);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.PRIVACY_FROM_EMAIL,
      to: [interview.candidateEmail],
      subject: "Verify your interview data deletion request",
      text: "A request was opened to delete your interview data. If you made this request, verify it using this secure link (expires in 30 minutes): " + verifyUrl.toString() + "\n\nIf you did not request this, do not use the link and contact the hiring organization.",
    })
  });
  if (!response.ok) {
    console.error("Deletion verification email delivery failed:", response.status);
    return NextResponse.json({ error: "Verification email could not be sent. You can safely retry; no data has been deleted." }, { status: 502 });
  }

  await db.privacyDeletionEvent.create({
    data: { requestId: deletion.id, action: "verification_email_sent", actor: "employer", details: "A time-limited verification link was sent to the candidate email stored on the interview." }
  });
  return NextResponse.json({ ok: true, expiresAt, message: "Verification email sent. The candidate must open the link and confirm. No data has been deleted." }, { headers: { "Cache-Control": "no-store" } });
}
