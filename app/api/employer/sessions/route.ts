import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json();
    const candidateName = String(body.candidateName || "").trim();
    const candidateEmail = String(body.candidateEmail || "").trim().toLowerCase();
    const role = String(body.role || "").trim();
    const resume = String(body.resume || "").trim();
    const jobDescription = String(body.jobDescription || "").trim();
    if (!candidateName || !candidateEmail || !role || !resume || !jobDescription) {
      return NextResponse.json({ error: "Candidate name, email, role, resume and job description are required." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) return NextResponse.json({ error: "Enter a valid candidate email." }, { status: 400 });
    const interview = await db.interview.create({ data: {
      candidateName: candidateName.slice(0,160), candidateEmail: candidateEmail.slice(0,254),
      role: role.slice(0,160), mode: body.mode === "recorded" ? "recorded" : "live",
      status: "invited", resumeText: resume.slice(0,20000), jobDescription: jobDescription.slice(0,16000)
    }, select: { id: true } });
    return NextResponse.json({ id: interview.id }, { status: 201 });
  } catch { return NextResponse.json({ error: "Could not create candidate interview." }, { status: 500 }); }
}
