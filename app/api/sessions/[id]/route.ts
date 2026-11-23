import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
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
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  const { id } = await context.params;
  try {
    const interview = await db.interview.findUnique({
      where: { id },
      select: {
        id: true, candidateName: true, candidateEmail: true, role: true,
        mode: true, status: true, resumeText: true, jobDescription: true,
        reportJson: true, overallScore: true, recommendation: true,
        recordingPath: true, employerDecision: true, employerNotes: true,
        decisionAt: true, durationSeconds: true, createdAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true }
        },
        decisionHistory: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, decision: true, notes: true, createdAt: true }
        }
      }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers });
    return NextResponse.json({ interview }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not load interview details." }, { status: 500, headers });
  }
}
