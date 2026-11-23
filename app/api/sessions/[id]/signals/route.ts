import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess, getEmployerSession } from "@/lib/auth";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const allowed = new Set(["offer", "answer", "ice", "hangup"]);

async function access(request: NextRequest, id: string) {
  const session = await getEmployerSession();
  if (session?.kind === "legacy") return "employer" as const;
  if (session?.kind === "user") {
    const organizationAccess = await getEmployerOrganizationAccess("interview:read");
    if (!organizationAccess) return null;
    const interview = await db.interview.findFirst({
      where: { id, organizationId: organizationAccess.organizationId },
      select: { id: true }
    });
    return interview ? "employer" as const : null;
  }
  const token = getCandidateInvitationToken(request, id);
  if (await hasValidCandidateInvitation(id, token)) return "candidate" as const;
  return null;
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const sender = await access(request, id);
  if (!sender) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const interview = await db.interview.findUnique({ where: { id }, select: { status: true, mode: true, startedAt: true, consentAcceptedAt: true } });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (interview.mode !== "live") return NextResponse.json({ signals: [] });
  if (interview.status === "completed") return NextResponse.json({ signals: [] });
  if (sender === "candidate" && (!interview.startedAt || !interview.consentAcceptedAt || interview.status !== "in_progress")) {
    return NextResponse.json({ error: "The live interview has not been started with candidate consent." }, { status: 409 });
  }
  const rawSince = request.nextUrl.searchParams.get("since");
  const afterId = request.nextUrl.searchParams.get("afterId") || "";
  const since = rawSince ? new Date(rawSince) : new Date(0);
  if (Number.isNaN(since.getTime()) || afterId.length > 64) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  const signals = await db.interviewSignal.findMany({
    where: {
      interviewId: id,
      sender: sender === "employer" ? "candidate" : "employer",
      OR: [{ createdAt: { gt: since } }, ...(rawSince && afterId ? [{ createdAt: since, id: { gt: afterId } }] : [])]
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
    select: { id: true, kind: true, payload: true, createdAt: true }
  });
  return NextResponse.json(
    { signals },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const sender = await access(request, id);
  if (!sender) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json();
    if (!allowed.has(body.kind) || typeof body.payload !== "string" || body.payload.length > 24000) {
      return NextResponse.json({ error: "Invalid signalling message." }, { status: 400 });
    }
    const interview = await db.interview.findUnique({ where: { id }, select: { mode: true, status: true, startedAt: true, consentAcceptedAt: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (interview.mode !== "live") return NextResponse.json({ error: "Live video is only enabled for live interviews." }, { status: 409 });
    if (interview.status === "completed") return NextResponse.json({ error: "This interview has ended." }, { status: 409 });
    if (sender === "candidate" && (!interview.startedAt || !interview.consentAcceptedAt || interview.status !== "in_progress")) {
      return NextResponse.json({ error: "The live interview has not been started with candidate consent." }, { status: 409 });
    }
    // The employer's ICE candidates may be generated while waiting for the candidate's
    // offer. Persist only ICE in that pre-join state; candidate media remains consent-gated.
    if (sender === "employer" && interview.status !== "in_progress" && body.kind !== "ice") {
      return NextResponse.json({ error: "The candidate has not joined the live interview yet." }, { status: 409 });
    }
    const signal = await db.interviewSignal.create({ data: { interviewId: id, sender, kind: body.kind, payload: body.payload } });
    return NextResponse.json({ ok: true, id: signal.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not send signalling message." }, { status: 500 });
  }
}
