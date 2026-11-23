import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess } from "@/lib/auth";
import { approveVerifiedDeletionRequest } from "@/lib/deletion-approval-service.mjs";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const access = await getEmployerOrganizationAccess("privacy:approve_deletion");
  if (!access) return NextResponse.json({ error: "Forbidden." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  try {
    const deletion = await db.privacyDeletionRequest.findUnique({ where: { id } });
    if (!deletion) return NextResponse.json({ error: "Deletion request not found." }, { status: 404 });
    const ownedInterview = await db.interview.findFirst({ where: { id: deletion.interviewId, organizationId: access.organizationId }, select: { id: true } });
    if (!ownedInterview) return NextResponse.json({ error: "Deletion request not found." }, { status: 404 });
    if (deletion.status !== "verified_pending_approval" || !deletion.verifiedAt) {
      return NextResponse.json({ error: "Candidate verification must be completed before employer approval." }, { status: 409 });
    }
    const approved = await approveVerifiedDeletionRequest(db, id);
    if (!approved) return NextResponse.json({ error: "Request changed. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ ok: true, status: "approved_for_deletion", message: "Approved for the separate deletion execution phase. No data has been deleted yet." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not approve deletion request." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
