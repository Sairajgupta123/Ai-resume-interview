import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess, getEmployerSession } from "@/lib/auth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitation";

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
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const resume = typeof body.resume === "string" ? body.resume.trim() : "";
    const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";
    if (!candidateName || !role || !resume || !jobDescription) {
      return NextResponse.json({ error: "Candidate name, role, resume and job description are required." }, { status: 400 });
    }
    if (candidateName.length > 160 || role.length > 160 || resume.length > 20000 || jobDescription.length > 16000) {
      return NextResponse.json({ error: "One or more interview fields exceed the allowed length." }, { status: 413 });
    }
    const candidateToken = createInvitationToken();
    const interview = await db.interview.create({
      data: {
        candidateName,
        role,
        mode: body.mode === "recorded" ? "recorded" : "live",
        status: "invited",
        resumeText: resume,
        jobDescription,
        ...(access ? { organizationId: access.organizationId } : {}),
        invitationTokenHash: hashInvitationToken(candidateToken),
        inviteExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
      },
      select: { id: true, createdAt: true }
    });
    return NextResponse.json({ ...interview, inviteToken: candidateToken }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not save interview. Check database setup." }, { status: 500 });
  }
}

export async function GET() {
  const session = await getEmployerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const access = session.kind === "user"
    ? await getEmployerOrganizationAccess("interview:read")
    : null;
  if (session.kind === "user" && !access) {
    return NextResponse.json({ error: "An active single-organization membership with interview read permission is required." }, { status: 403 });
  }
  try {
    const interviews = await db.interview.findMany({
      ...(access ? { where: { organizationId: access.organizationId } } : {}),
      orderBy: { createdAt: "desc" },
      select: { id: true, candidateName: true, role: true, mode: true, status: true, overallScore: true, recommendation: true, employerDecision: true, durationSeconds: true, createdAt: true }
    });
    return NextResponse.json({ interviews }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load interviews." }, { status: 500 });
  }
}
