import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess, getEmployerSession, isEmployerAuthenticated } from "@/lib/auth";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { elapsedInterviewSeconds, INTERVIEW_LIMIT_SECONDS } from "@/lib/interview-policy.mjs";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, status: true, startedAt: true }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (interview.status === "completed") {
      return NextResponse.json({ error: "Completed interview sessions are read-only." }, { status: 409 });
    }

    const employer = await isEmployerAuthenticated();
    const candidate = await hasValidCandidateInvitation(id, getCandidateInvitationToken(request, id));
    if (!employer && !candidate) return NextResponse.json({ error: "Unauthorized interview update." }, { status: 401 });

    // Transcript entries, reports, and duration are server-owned. In particular,
    // never trust a candidate-supplied timer value for employer-facing analytics.
    if (typeof body.durationSeconds === "number") {
      if (interview.status !== "in_progress" || !interview.startedAt) {
        return NextResponse.json({ error: "Interview duration is available only after the interview starts." }, { status: 409 });
      }
      const durationSeconds = Math.min(
        INTERVIEW_LIMIT_SECONDS,
        elapsedInterviewSeconds(interview.startedAt)
      );
      const updated = await db.interview.updateMany({
        where: { id, status: "in_progress", startedAt: interview.startedAt },
        data: { durationSeconds }
      });
      if (updated.count !== 1) {
        return NextResponse.json({ error: "The interview changed while its duration was being updated." }, { status: 409 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update interview." }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: Context) {
  const session = await getEmployerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const access = session.kind === "user"
    ? await getEmployerOrganizationAccess("interview:read")
    : null;
  if (session.kind === "user" && !access) return NextResponse.json({ error: "An active single-organization membership with interview read permission is required." }, { status: 403 });
  const { id } = await context.params;
  const interview = await db.interview.findFirst({
    where: { id, ...(access ? { organizationId: access.organizationId } : {}) },
    include: { messages: { orderBy: { createdAt: "asc" } }, decisionHistory: { orderBy: { createdAt: "desc" } } }
  });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  return NextResponse.json(
    { interview },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
