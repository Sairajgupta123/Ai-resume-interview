import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { isEmployerAuthenticated } from "@/lib/auth";
import { hasValidCandidateInvitation } from "@/lib/invitation";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const exists = await db.interview.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!exists) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (exists.status === "completed") {
      return NextResponse.json({ error: "Completed interview sessions are read-only." }, { status: 409 });
    }

    const employer = await isEmployerAuthenticated();
    const candidate = await hasValidCandidateInvitation(id, request.headers.get("x-interview-invite"));
    if (!employer && !candidate) return NextResponse.json({ error: "Unauthorized interview update." }, { status: 401 });

    // Transcript entries and final reports are written only by the server-side AI interview route.
    // Never let a candidate overwrite evidence or submit their own score/report.
    const data: Prisma.InterviewUpdateInput = {};
    if (typeof body.durationSeconds === "number") {
      data.durationSeconds = Math.max(0, Math.min(900, Math.floor(body.durationSeconds)));
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
    where: { id }, include: { messages: { orderBy: { createdAt: "asc" } }, decisionHistory: { orderBy: { createdAt: "desc" } } }
  });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  return NextResponse.json({ interview });
}
