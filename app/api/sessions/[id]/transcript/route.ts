import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { elapsedInterviewSeconds, INTERVIEW_LIMIT_SECONDS } from "@/lib/interview-policy.mjs";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const MAX_TRANSCRIPT_LENGTH = 12_000;

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;

  try {
    const token = getCandidateInvitationToken(request, id);
    if (!(await hasValidCandidateInvitation(id, token))) {
      return NextResponse.json({ error: "Unauthorized interview session." }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "A JSON transcript entry is required." }, { status: 415 });
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
      return NextResponse.json({ error: "Transcript request is too large." }, { status: 413 });
    }
    let body: { role?: unknown; content?: unknown };
    try {
      body = JSON.parse(rawBody) as { role?: unknown; content?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid transcript JSON." }, { status: 400 });
    }
    if (body.role !== "user" && body.role !== "assistant") {
      return NextResponse.json({ error: "Transcript speaker must be user or assistant." }, { status: 400 });
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      return NextResponse.json({ error: "Transcript text is required." }, { status: 400 });
    }
    const content = body.content.trim();
    if (content.length > MAX_TRANSCRIPT_LENGTH) {
      return NextResponse.json({ error: "Transcript entry is too long." }, { status: 413 });
    }

    const interview = await db.interview.findUnique({
      where: { id },
      select: { mode: true, status: true, startedAt: true, consentAcceptedAt: true, inviteExpiresAt: true }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (
      interview.mode !== "live" ||
      interview.status !== "in_progress" ||
      !interview.startedAt ||
      !interview.consentAcceptedAt ||
      !interview.inviteExpiresAt ||
      interview.inviteExpiresAt.getTime() <= Date.now()
    ) {
      return NextResponse.json({ error: "A consented, active live interview is required." }, { status: 409 });
    }
    if (elapsedInterviewSeconds(interview.startedAt) >= INTERVIEW_LIMIT_SECONDS) {
      return NextResponse.json({ error: "The interview time limit has been reached." }, { status: 409 });
    }

    // Re-check the active session inside the transaction so a concurrent report or
    // completion cannot leave transcript entries attached to a completed interview.
    await db.$transaction(async (tx) => {
      const current = await tx.interview.findUnique({
        where: { id },
        select: { status: true, mode: true, consentAcceptedAt: true, startedAt: true, reportLockAt: true }
      });
      if (
        !current ||
        current.status !== "in_progress" ||
        current.mode !== "live" ||
        !current.consentAcceptedAt ||
        !current.startedAt ||
        current.reportLockAt !== null ||
        elapsedInterviewSeconds(current.startedAt) >= INTERVIEW_LIMIT_SECONDS
      ) {
        throw new Error("INTERVIEW_NOT_ACTIVE");
      }
      await tx.interviewMessage.create({
        data: { interviewId: id, role: body.role as string, content }
      });
    });

    return NextResponse.json({ saved: true }, {
      headers: { "Cache-Control": "no-store, private" }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INTERVIEW_NOT_ACTIVE") {
      return NextResponse.json({ error: "The interview is no longer active." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not save the transcript entry. Please retry." }, { status: 500 });
  }
}
