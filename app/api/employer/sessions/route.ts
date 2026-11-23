import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess, getEmployerSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await getEmployerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const access = session.kind === "user"
    ? await getEmployerOrganizationAccess("interview:create")
    : null;
  if (session.kind === "user" && !access) {
    return NextResponse.json({ error: "An active single-organization membership with interview creation permission is required." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const candidateName = typeof body.candidateName === "string" ? body.candidateName.trim() : "";
    const candidateEmail = typeof body.candidateEmail === "string" ? body.candidateEmail.trim().toLowerCase() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const resume = typeof body.resume === "string" ? body.resume.trim() : "";
    const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
    if (!candidateName || !candidateEmail || !role || !resume || !jobDescription) {
      return NextResponse.json({ error: "Candidate name, email, role, resume and job description are required." }, { status: 400 });
    }
    if (candidateName.length > 160 || candidateEmail.length > 254 || role.length > 160 || resume.length > 20000 || jobDescription.length > 16000) {
      return NextResponse.json({ error: "One or more interview fields exceed the allowed length." }, { status: 413 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
      return NextResponse.json({ error: "Enter a valid candidate email." }, { status: 400 });
    }
    const interview = await db.interview.create({
      data: {
        candidateName,
        candidateEmail,
        role,
        mode: body.mode === "recorded" ? "recorded" : "live",
        status: "invited",
        resumeText: resume,
        jobDescription,
        ...(access ? { organizationId: access.organizationId } : {})
      },
      select: { id: true }
    });
    return NextResponse.json({ id: interview.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not create candidate interview." }, { status: 500 });
  }
}
