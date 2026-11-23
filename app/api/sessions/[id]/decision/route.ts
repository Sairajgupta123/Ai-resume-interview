import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

type Context = { params: Promise<{ id: string }> };
const decisions = ["shortlist", "review", "reject"] as const;

export async function POST(request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "A JSON decision payload is required." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 8_192) {
    return NextResponse.json({ error: "Decision request is too large." }, { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Decision request body is missing." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > 8_192) {
        await reader.cancel();
        return NextResponse.json({ error: "Decision request is too large." }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
  } catch {
    return NextResponse.json({ error: "Could not read decision request body." }, { status: 400 });
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
    return NextResponse.json({ error: "Request body must contain valid JSON." }, { status: 400 });
  }
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A valid decision payload is required." }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const decision = typeof payload.decision === "string" ? payload.decision.trim().toLowerCase() : "";
    if (!decisions.includes(decision as typeof decisions[number])) {
      return NextResponse.json({ error: "Choose shortlist, review or reject." }, { status: 400 });
    }
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") {
      return NextResponse.json({ error: "Decision notes must be plain text." }, { status: 400 });
    }
    const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
    if (notes.length > 3000) {
      return NextResponse.json({ error: "Decision notes must be 3,000 characters or fewer." }, { status: 413 });
    }
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
