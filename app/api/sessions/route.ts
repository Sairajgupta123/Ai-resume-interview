import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.candidateName || !body.role || !body.resume || !body.jobDescription) {
      return NextResponse.json({ error: "Candidate name, role, resume and job description are required." }, { status: 400 });
    }
    const interview = await db.interview.create({
      data: {
        candidateName: String(body.candidateName).slice(0, 160),
        role: String(body.role).slice(0, 160),
        mode: body.mode === "recorded" ? "recorded" : "live",
        status: "in_progress",
        resumeText: String(body.resume).slice(0, 20000),
        jobDescription: String(body.jobDescription).slice(0, 16000)
      },
      select: { id: true, createdAt: true }
    });
    return NextResponse.json(interview, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not save interview. Check database setup." }, { status: 500 });
  }
}

export async function GET() {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const interviews = await db.interview.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, candidateName: true, role: true, mode: true, status: true, overallScore: true, recommendation: true, durationSeconds: true, createdAt: true }
  });
  return NextResponse.json({ interviews });
}