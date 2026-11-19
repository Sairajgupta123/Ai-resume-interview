import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const exists = await db.interview.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (Array.isArray(body.messages)) {
      await db.interviewMessage.deleteMany({ where: { interviewId: id } });
      await db.interviewMessage.createMany({
        data: body.messages.slice(-100).map((m: { role: string; content: string }) => ({
          interviewId: id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || "").slice(0, 12000)
        }))
      });
    }
    const data: Record<string, unknown> = {};
    if (typeof body.status === "string") data.status = body.status;
    if (typeof body.durationSeconds === "number") data.durationSeconds = Math.max(0, Math.min(900, Math.floor(body.durationSeconds)));
    if (body.report && typeof body.report === "object") {
      data.reportJson = JSON.stringify(body.report);
      data.overallScore = Math.max(0, Math.min(100, Math.round(Number(body.report.overallScore) || 0)));
      data.recommendation = String(body.report.recommendation || "Needs review").slice(0, 80);
      data.status = "completed";
    }
    await db.interview.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update interview." }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const interview = await db.interview.findUnique({
    where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } }
  });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  return NextResponse.json({ interview });
}