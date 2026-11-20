import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { candidateInvitationCookieName, getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";

type Context = { params: Promise<{ id: string }> };

async function candidateResponse(id: string, token: string | null) {
  if (!(await hasValidCandidateInvitation(id, token))) {
    return NextResponse.json({ error: "This interview invitation is invalid or expired. Contact the employer for a new link." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const interview = await db.interview.findUnique({
    where: { id },
    select: {
      id: true,
      candidateName: true,
      role: true,
      mode: true,
      resumeText: true,
      jobDescription: true,
      status: true,
      recordingPath: true,
      inviteExpiresAt: true,
      startedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100,
        select: { role: true, content: true }
      }
    }
  });

  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (interview.status === "completed") return NextResponse.json({ error: "This interview has already been completed." }, { status: 409 });
  if (!interview.inviteExpiresAt) return NextResponse.json({ error: "This interview invitation has expired." }, { status: 401 });

  const { recordingPath, ...candidateInterview } = interview;
  const response = NextResponse.json({
    interview: { ...candidateInterview, recordingSaved: Boolean(recordingPath) }
  }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(candidateInvitationCookieName(id), token!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((interview.inviteExpiresAt.getTime() - Date.now()) / 1000))
  });
  return response;
}

// Exchange the one-time link token in the request body, not the URL, for an HttpOnly cookie.
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token : null;
    return candidateResponse(id, token);
  } catch {
    return NextResponse.json({ error: "Invalid invitation request." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}

// Refresh recovery uses only the HttpOnly cookie; bearer tokens are never accepted in query parameters.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return candidateResponse(id, getCandidateInvitationToken(request, id));
}
