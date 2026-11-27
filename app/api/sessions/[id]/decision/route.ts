import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

type Context = { params: Promise<{ id: string }> };
const decisions = ["shortlist", "review", "reject"] as const;
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: privateHeaders });
  const { id } = await context.params;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "A JSON decision payload is required." }, { status: 415, headers: privateHeaders });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 8_192) {
    return NextResponse.json({ error: "Decision request is too large." }, { status: 413, headers: privateHeaders });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Decision request body is missing." }, { status: 400, headers: privateHeaders });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > 8_192) {
        await reader.cancel();
        return NextResponse.json({ error: "Decision request is too large." }, { status: 413, headers: privateHeaders });
      }
      chunks.push(chunk.value);
    }
  } catch {
    return NextResponse.json({ error: "Could not read decision request body." }, { status: 400, headers: privateHeaders });
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON." }, { status: 400, headers: privateHeaders });
  }
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A valid decision payload is required." }, { status: 400, headers: privateHeaders });
    }
    const payload = body as Record<string, unknown>;
    const decision = typeof payload.decision === "string" ? payload.decision.trim().toLowerCase() : "";
    if (!decisions.includes(decision as typeof decisions[number])) {
      return NextResponse.json({ error: "Choose shortlist, review or reject." }, { status: 400, headers: privateHeaders });
    }
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") {
      return NextResponse.json({ error: "Decision notes must be plain text." }, { status: 400, headers: privateHeaders });
    }
    const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
    if (notes.length > 3000) {
      return NextResponse.json({ error: "Decision notes must be 3,000 characters or fewer." }, { status: 413, headers: privateHeaders });
    }
    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, status: true }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers: privateHeaders });
    if (interview.status !== "completed") {
      return NextResponse.json({ error: "Employer decisions can be recorded only after an interview is completed." }, { status: 409, headers: privateHeaders });
    }
    const updated = await db.$transaction(async tx => {
      // Re-check status inside the transaction to prevent a stale dashboard
      // from recording a hiring decision while the interview is still running.
      const eligible = await tx.interview.findFirst({
        where: { id, status: "completed" },
        select: { id: true }
      });
      if (!eligible) throw new Error("INTERVIEW_NOT_COMPLETED");
      await tx.employerDecisionHistory.create({
        data: { interviewId: id, decision, notes: notes || null }
      });
      return tx.interview.update({
        where: { id },
        data: {
          employerDecision: decision,
          employerNotes: notes || null,
          decisionAt: new Date()
        },
        select: { employerDecision: true, employerNotes: true, decisionAt: true }
      });
    });
    const decisionHistory = await db.employerDecisionHistory.findMany({
      where: { interviewId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, decision: true, notes: true, createdAt: true }
    });
    return NextResponse.json({
      ok: true,
      decision: updated.employerDecision,
      notes: updated.employerNotes,
      decisionAt: updated.decisionAt,
      decisionHistory
    }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "INTERVIEW_NOT_COMPLETED") {
      return NextResponse.json({ error: "Employer decisions can be recorded only after an interview is completed." }, { status: 409, headers: privateHeaders });
    }
    return NextResponse.json({ error: "Could not save employer decision." }, { status: 500, headers: privateHeaders });
  }
}
