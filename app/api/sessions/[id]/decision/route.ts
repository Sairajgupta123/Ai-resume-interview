import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

type Context = { params: Promise<{ id: string }> };
const decisions = ["shortlist", "review", "reject"] as const;

export async function POST(request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  try {
    const body = await request.json();
    const decision = String(body.decision || "").toLowerCase();
    if (!decisions.includes(decision as typeof decisions[number])) {
      return NextResponse.json({ error: "Choose shortlist, review or reject." }, { status: 400 });
    }
    const notes = String(body.notes || "").trim().slice(0, 3000);
    const interview = await db.interview.findUnique({ where: { id }, select: { id: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    const [, updated] = await db.$transaction([
      db.employerDecisionHistory.create({ data: { interviewId: id, decision, notes: notes || null } }),
      db.interview.update({ where: { id }, data: {
        employerDecision: decision,
        employerNotes: notes || null,
        decisionAt: new Date()
      }, select: { employerDecision: true, employerNotes: true, decisionAt: true } })
    ]);
    return NextResponse.json({ ok: true, decision: updated.employerDecision, notes: updated.employerNotes, decisionAt: updated.decisionAt });
  } catch {
    return NextResponse.json({ error: "Could not save employer decision." }, { status: 500 });
  }
}
