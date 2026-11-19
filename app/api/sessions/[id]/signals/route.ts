import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { hasValidCandidateInvitation } from "@/lib/invitation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const allowed = new Set(["offer", "answer", "ice", "hangup"]);

async function access(request: NextRequest, id: string) {
  const employer = await isEmployerAuthenticated();
  if (employer) return "employer" as const;
  const token = request.headers.get("x-interview-invite");
  if (await hasValidCandidateInvitation(id, token)) return "candidate" as const;
  return null;
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const sender = await access(request, id);
  if (!sender) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const interview = await db.interview.findUnique({ where: { id }, select: { status: true, mode: true } });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (interview.mode !== "live") return NextResponse.json({ signals: [] });
  const rawSince = request.nextUrl.searchParams.get("since");
  const since = rawSince ? new Date(rawSince) : new Date(0);
  if (Number.isNaN(since.getTime())) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  const signals = await db.interviewSignal.findMany({
    where: { interviewId: id, sender: sender === "employer" ? "candidate" : "employer", createdAt: { gt: since } },
    orderBy: { createdAt: "asc" }, take: 50,
    select: { id: true, kind: true, payload: true, createdAt: true }
  });
  return NextResponse.json({ signals });
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
    const interview = await db.interview.findUnique({ where: { id }, select: { mode: true, status: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (interview.mode !== "live") return NextResponse.json({ error: "Live video is only enabled for live interviews." }, { status: 409 });
    if (interview.status === "completed" && body.kind !== "hangup") return NextResponse.json({ error: "This interview has ended." }, { status: 409 });
    const signal = await db.interviewSignal.create({ data: { interviewId: id, sender, kind: body.kind, payload: body.payload } });
    return NextResponse.json({ ok: true, id: signal.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not send signalling message." }, { status: 500 });
  }
}
