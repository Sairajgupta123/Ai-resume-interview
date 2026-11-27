import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { elapsedInterviewSeconds, INTERVIEW_LIMIT_SECONDS } from "@/lib/interview-policy.mjs";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "A JSON session update is required." }, { status: 415, headers });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 8_192) {
    return NextResponse.json({ error: "Session update is too large." }, { status: 413, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Session update body is missing." }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > 8_192) {
        await reader.cancel();
        return NextResponse.json({ error: "Session update is too large." }, { status: 413, headers });
      }
      chunks.push(chunk.value);
    }
  } catch {
    return NextResponse.json({ error: "Could not read session update body." }, { status: 400, headers });
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Session update must be a JSON object." }, { status: 400, headers });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid session update JSON." }, { status: 400, headers });
  }
  if (Object.keys(body).length !== 1 || typeof body.durationSeconds !== "number" || !Number.isFinite(body.durationSeconds) || body.durationSeconds < 0) {
    return NextResponse.json({ error: "Only a valid duration update is accepted." }, { status: 400, headers });
  }
  try {
    // Authenticate before looking up the session so unauthorised callers cannot
    // distinguish an existing interview from an unknown session ID.
    const employer = await isEmployerAuthenticated();
    const candidate = employer ? false : await hasValidCandidateInvitation(id, getCandidateInvitationToken(request, id));
    if (!employer && !candidate) return NextResponse.json({ error: "Unauthorized interview update." }, { status: 401, headers });

    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, status: true, startedAt: true }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers });
    if (interview.status === "completed") {
      return NextResponse.json({ error: "Completed interview sessions are read-only." }, { status: 409, headers });
    }

    // Transcript entries, reports, and duration are server-owned. In particular,
    // never trust a candidate-supplied timer value for employer-facing analytics.
    if (typeof body.durationSeconds === "number") {
      if (interview.status !== "in_progress" || !interview.startedAt) {
        return NextResponse.json({ error: "Interview duration is available only after the interview starts." }, { status: 409, headers });
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
        return NextResponse.json({ error: "The interview changed while its duration was being updated." }, { status: 409, headers });
      }
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not update interview." }, { status: 500, headers });
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
          // Match report recovery's bounded transcript window. Fetch newest
          // turns first so legacy or malformed sessions cannot create an
          // unbounded employer dashboard response.
          orderBy: { createdAt: "desc" },
          take: 200,
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
    // Expose only whether a recording exists. Keep local paths and private object
    // keys inside the server so dashboard clients cannot inspect storage layout.
    const { recordingPath, ...publicInterview } = interview;
    return NextResponse.json({
      interview: {
        ...publicInterview,
        // Preserve chronological display order after the bounded newest-first read.
        messages: publicInterview.messages.slice().reverse(),
        hasRecording: Boolean(recordingPath)
      }
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not load interview details." }, { status: 500, headers });
  }
}
