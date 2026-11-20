import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { validateEmployerDecisionInput } from "@/lib/employer-decision-policy.mjs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON decision request is required." }, { status: 400 });
  }
  const validation = validateEmployerDecisionInput(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  try {
    const result = await db.$transaction(async tx => {
      const updatedCount = await tx.interview.updateMany({
        where: { id, decisionAt: validation.expectedDecisionAt },
        data: {
          employerDecision: validation.decision,
          employerNotes: validation.notes || null,
          decisionAt: new Date()
        }
      });
      if (updatedCount.count !== 1) {
        const exists = await tx.interview.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new Error("INTERVIEW_NOT_FOUND");
        throw new Error("DECISION_VERSION_CONFLICT");
      }
      const updated = await tx.interview.findUnique({
        where: { id },
        select: { employerDecision: true, employerNotes: true, decisionAt: true }
      });
      if (!updated) throw new Error("INTERVIEW_NOT_FOUND");
      const historyEvent = await tx.employerDecisionHistory.create({
        data: { interviewId: id, decision: validation.decision, notes: validation.notes || null }
      });
      return { updated, historyEvent };
    });
    return NextResponse.json({
      ok: true,
      decision: result.updated.employerDecision,
      notes: result.updated.employerNotes,
      decisionAt: result.updated.decisionAt,
      historyEvent: result.historyEvent
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "INTERVIEW_NOT_FOUND") {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "DECISION_VERSION_CONFLICT") {
      return NextResponse.json({ error: "Another employer decision was saved after this review was opened. Refresh the candidate review before saving again." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not save employer decision." }, { status: 500 });
  }
}
