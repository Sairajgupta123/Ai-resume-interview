import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  try {
    const deletion = await db.privacyDeletionRequest.findUnique({ where: { id } });
    if (!deletion) return NextResponse.json({ error: "Deletion request not found." }, { status: 404 });
    if (deletion.status !== "verified_pending_approval" || !deletion.verifiedAt) {
      return NextResponse.json({ error: "Candidate verification must be completed before employer approval." }, { status: 409 });
    }
    const approved = await db.$transaction(async tx => {
      const changed = await tx.privacyDeletionRequest.updateMany({
        where: { id, status: "verified_pending_approval", verifiedAt: { not: null } },
        data: { status: "approved_for_deletion" }
      });
      if (changed.count !== 1) return false;
      await tx.privacyDeletionEvent.create({
        data: { requestId: id, action: "employer_approved", actor: "employer", details: "Employer approved the verified deletion request. Data deletion has not yet run." }
      });
      return true;
    });
    if (!approved) return NextResponse.json({ error: "Request changed. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ ok: true, status: "approved_for_deletion", message: "Approved for the separate deletion execution phase. No data has been deleted yet." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not approve deletion request." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
