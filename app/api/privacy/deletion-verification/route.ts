import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canVerifyDeletionRequest, hashDeletionVerificationToken, verifyDeletionVerificationToken } from "@/lib/deletion-verification-policy.mjs";
import { verifyDeletionRequest } from "@/lib/deletion-verification-service.mjs";
import { readBoundedJson } from "@/lib/bounded-json.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const contentType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415, headers: { "Cache-Control": "no-store" } });
    }
    const parsed = await readBoundedJson(request, 8 * 1024);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: { "Cache-Control": "no-store" } });
    }
    const body = parsed.value;
    const token = typeof body.token === "string" ? body.token : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!requestId || requestId.length > 128 || token.length < 32 || token.length > 256) return NextResponse.json({ error: "Verification link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const tokenHash = hashDeletionVerificationToken(token);
    const deletion = await db.privacyDeletionRequest.findUnique({ where: { id: requestId } });
    if (!deletion || !canVerifyDeletionRequest(deletion)) {
      return NextResponse.json({ error: "Verification link is invalid, expired, or no longer active." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!verifyDeletionVerificationToken(token, deletion.verificationTokenHash)) {
      await db.privacyDeletionRequest.updateMany({
        where: { id: deletion.id, status: "pending_candidate_verification", verificationAttempts: { lt: 5 } },
        data: { verificationAttempts: { increment: 1 } }
      });
      return NextResponse.json({ error: "Verification link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const verified = await verifyDeletionRequest(db, deletion.id, tokenHash);
    if (!verified) return NextResponse.json({ error: "Verification link has already been used or expired." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ ok: true, localRecordingSessionId: deletion.interviewId, message: "Your identity has been verified. The hiring organization must separately approve the deletion request. No data has been deleted." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not verify this deletion request." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
