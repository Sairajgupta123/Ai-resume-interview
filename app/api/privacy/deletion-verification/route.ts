import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canVerifyDeletionRequest, hashDeletionVerificationToken, verifyDeletionVerificationToken } from "@/lib/deletion-verification-policy.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!requestId || token.length < 32 || token.length > 256) return NextResponse.json({ error: "Verification link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
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
    const result = await db.$transaction(async tx => {
      const changed = await tx.privacyDeletionRequest.updateMany({
        where: {
          id: deletion.id,
          status: "pending_candidate_verification",
          verificationTokenHash: tokenHash,
          verificationExpiresAt: { gt: new Date() },
          verificationAttempts: { lt: 5 }
        },
        data: {
          status: "verified_pending_approval",
          verifiedAt: new Date(),
          verificationTokenHash: null,
          verificationExpiresAt: null
        }
      });
      if (changed.count !== 1) return false;
      await tx.privacyDeletionEvent.create({
        data: { requestId: deletion.id, action: "candidate_verified", actor: "candidate", details: "Candidate completed verification using the time-limited email link." }
      });
      return true;
    });
    if (!result) return NextResponse.json({ error: "Verification link has already been used or expired." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ ok: true, message: "Your identity has been verified. The hiring organization must separately approve the deletion request. No data has been deleted." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not verify this deletion request." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
