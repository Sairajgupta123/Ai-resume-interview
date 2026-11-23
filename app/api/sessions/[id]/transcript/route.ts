import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { elapsedInterviewSeconds, INTERVIEW_LIMIT_SECONDS } from "@/lib/interview-policy.mjs";
import { isTranscriptRetryCompatible, isNextTranscriptRole } from "@/lib/transcript-policy.mjs";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const MAX_TRANSCRIPT_LENGTH = 12_000;

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;

  try {
    const token = getCandidateInvitationToken(request, id);
    if (!(await hasValidCandidateInvitation(id, token))) {
      return NextResponse.json({ error: "Unauthorized interview session." }, { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "A JSON transcript entry is required." }, { status: 415 });
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 16_384) {
      return NextResponse.json({ error: "Transcript request is too large." }, { status: 413 });
    }
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Transcript request body is missing." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > 16_384) {
        await reader.cancel();
        return NextResponse.json({ error: "Transcript request is too large." }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let body: { role?: unknown; content?: unknown; clientMessageId?: unknown };
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Transcript payload must be an object." }, { status: 400 });
      }
      body = parsed as { role?: unknown; content?: unknown; clientMessageId?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid transcript JSON." }, { status: 400 });
    }
    if (body.role !== "user" && body.role !== "assistant") {
      return NextResponse.json({ error: "Transcript speaker must be user or assistant." }, { status: 400 });
    }
    if (
      typeof body.clientMessageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientMessageId)
    ) {
      return NextResponse.json({ error: "A valid transcript message ID is required." }, { status: 400 });
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
      const existing = await tx.interviewMessage.findUnique({
        where: { clientMessageId: body.clientMessageId as string },
        select: { interviewId: true, role: true, content: true }
      });
      if (existing) {
        if (!isTranscriptRetryCompatible(existing, {
          interviewId: id,
          role: body.role,
          content
        })) throw new Error("TRANSCRIPT_ID_CONFLICT");
        return;
      }
      const latestMessage = await tx.interviewMessage.findFirst({
        where: { interviewId: id },
        orderBy: { createdAt: "desc" },
        select: { role: true, createdAt: true }
      });
      if (latestMessage && !isNextTranscriptRole(latestMessage.role, body.role)) {
        throw new Error("TRANSCRIPT_ROLE_ORDER");
      }
      const messageCount = await tx.interviewMessage.count({ where: { interviewId: id } });
      if (messageCount >= 200) throw new Error("TRANSCRIPT_LIMIT_REACHED");
      const createdAt = new Date(Math.max(Date.now(), (latestMessage?.createdAt.getTime() || 0) + 1));
      await tx.interviewMessage.create({
        data: { interviewId: id, role: body.role as string, content, clientMessageId: body.clientMessageId as string, createdAt }
      });
    });

    return NextResponse.json({ saved: true }, {
      headers: { "Cache-Control": "no-store, private" }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INTERVIEW_NOT_ACTIVE") {
      return NextResponse.json({ error: "The interview is no longer active." }, { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    if (error instanceof Error && error.message === "TRANSCRIPT_LIMIT_REACHED") {
      return NextResponse.json({ error: "The transcript has reached its message limit." }, { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    if (error instanceof Error && error.message === "TRANSCRIPT_ROLE_ORDER") {
      return NextResponse.json({ error: "Transcript entries must alternate between candidate and interviewer turns." }, { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    if (error instanceof Error && error.message === "TRANSCRIPT_ID_CONFLICT") {
      return NextResponse.json({ error: "Transcript message ID conflict." }, { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    return NextResponse.json({ error: "Could not save the transcript entry. Please retry." }, { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
