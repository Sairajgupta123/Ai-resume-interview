import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { validateSignalPayload, isSignalOlderThanDescription } from "@/lib/signalling-policy.mjs";
import { isInterviewTimeLimitReached } from "@/lib/interview-policy.mjs";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const allowed = new Set(["offer", "answer", "ice", "hangup"]);
const MAX_SIGNAL_BODY_BYTES = 32_768;

async function readSignalBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const mediaType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") return null;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_SIGNAL_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_SIGNAL_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function access(request: NextRequest, id: string) {
  const employer = await isEmployerAuthenticated();
  if (employer) return "employer" as const;
  const token = getCandidateInvitationToken(request, id);
  if (await hasValidCandidateInvitation(id, token)) return "candidate" as const;
  return null;
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
  const sender = await access(request, id);
  if (!sender) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  const interview = await db.interview.findUnique({ where: { id }, select: { status: true, mode: true, startedAt: true, consentAcceptedAt: true } });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers });
  if (interview.mode !== "live") return NextResponse.json({ signals: [] }, { headers });
  if (interview.status === "completed" || (interview.startedAt && isInterviewTimeLimitReached(interview.startedAt))) {
    return NextResponse.json({ signals: [] }, { headers });
  }
  if (sender === "candidate" && (!interview.startedAt || !interview.consentAcceptedAt || interview.status !== "in_progress")) {
    return NextResponse.json({ error: "The live interview has not been started with candidate consent." }, { status: 409, headers });
  }
  const rawSince = request.nextUrl.searchParams.get("since");
  const afterId = request.nextUrl.searchParams.get("afterId") || "";
  const since = rawSince ? new Date(rawSince) : new Date(0);
  if (Number.isNaN(since.getTime()) || afterId.length > 64) return NextResponse.json({ error: "Invalid cursor." }, { status: 400, headers });
  const remoteSender = sender === "employer" ? "candidate" : "employer";
  const descriptionKind = sender === "employer" ? "offer" : "answer";
  const latestDescription = await db.interviewSignal.findFirst({
    where: { interviewId: id, sender: remoteSender, kind: descriptionKind },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, kind: true, payload: true, createdAt: true }
  });

  // Filter superseded descriptions and stale hangups in the database query,
  // before applying the 50-row page limit. Filtering after pagination could
  // return an empty page whose cursor never advances, trapping the peer on
  // the same 50 obsolete rows forever.
  const currentSignalFilters: Record<string, unknown>[] = [
    { OR: [{ kind: { not: descriptionKind } }, ...(latestDescription ? [{ id: latestDescription.id }] : [])] }
  ];
  if (latestDescription) {
    currentSignalFilters.push({
      OR: [
        { kind: { not: "hangup" } },
        { createdAt: { gt: latestDescription.createdAt } },
        { createdAt: latestDescription.createdAt, id: { gt: latestDescription.id } }
      ]
    });
  }
  const signals = await db.interviewSignal.findMany({
    where: {
      interviewId: id,
      sender: remoteSender,
      AND: currentSignalFilters,
      OR: [{ createdAt: { gt: since } }, ...(rawSince && afterId ? [{ createdAt: since, id: { gt: afterId } }] : [])]
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
    select: { id: true, kind: true, payload: true, createdAt: true }
  });

  // The database has already excluded older SDP revisions and hangups that
  // belong to a superseded negotiation, so every paged row is actionable.
  // Do not append a newer SDP description outside the ordered 50-row page:
  // doing so would advance the client's cursor past older, unreturned ICE rows.
  // The next poll will reach the description naturally after draining prior rows.
  currentSignals.sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
  );
  return NextResponse.json({ signals: currentSignals }, { headers });
}
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
  const sender = await access(request, id);
  if (!sender) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  try {
    const body = await readSignalBody(request);
    if (!body) return NextResponse.json({ error: "Send a valid signalling JSON body smaller than 32 KB." }, { status: 400, headers });
    if (typeof body.kind !== "string" || !allowed.has(body.kind) || typeof body.payload !== "string") {
      return NextResponse.json({ error: "Invalid signalling message." }, { status: 400, headers });
    }
    const validation = validateSignalPayload(body.kind, body.payload, sender);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400, headers });
    }
    const interview = await db.interview.findUnique({ where: { id }, select: { mode: true, status: true, startedAt: true, consentAcceptedAt: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers });
    if (interview.mode !== "live") return NextResponse.json({ error: "Live video is only enabled for live interviews." }, { status: 409, headers });
    if (interview.status === "completed" || (interview.startedAt && isInterviewTimeLimitReached(interview.startedAt))) {
      return NextResponse.json({ error: "The 15-minute interview time limit has been reached." }, { status: 409, headers });
    }
    if (sender === "candidate" && (!interview.startedAt || !interview.consentAcceptedAt || interview.status !== "in_progress")) {
      return NextResponse.json({ error: "The live interview has not been started with candidate consent." }, { status: 409, headers });
    }
    // The employer's ICE candidates may be generated while waiting for the candidate's
    // offer. Persist only ICE in that pre-join state; candidate media remains consent-gated.
    if (sender === "employer" && interview.status !== "in_progress" && body.kind !== "ice") {
      return NextResponse.json({ error: "The candidate has not joined the live interview yet." }, { status: 409, headers });
    }
    // Live interviews are limited to 15 minutes. Keep a one-hour safety window
    // for polling/retries while pruning abandoned signalling records opportunistically.
    await db.interviewSignal.deleteMany({
      where: { interviewId: id, createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } }
    });
    const signal = await db.interviewSignal.create({ data: { interviewId: id, sender, kind: body.kind, payload: body.payload } });
    return NextResponse.json({ ok: true, id: signal.id, createdAt: signal.createdAt }, { status: 201, headers });
  } catch {
    return NextResponse.json({ error: "Could not send signalling message." }, { status: 500, headers });
  }
}
