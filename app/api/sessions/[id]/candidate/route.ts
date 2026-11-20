import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { candidateInvitationCookieName, getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const token = request.nextUrl.searchParams.get("token") || getCandidateInvitationToken(request, id);
  if (!(await hasValidCandidateInvitation(id, token))) return NextResponse.json({ error: "This interview invitation is invalid or expired. Contact the employer for a new link." }, { status: 401 });
  const interview = await db.interview.findUnique({ where: { id }, select: {
    id: true, candidateName: true, role: true, mode: true, resumeText: true, jobDescription: true, status: true, inviteExpiresAt: true
  } });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (interview.status === "completed") return NextResponse.json({ error: "This interview has already been completed." }, { status: 409 });
  const response = NextResponse.json({ interview }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(candidateInvitationCookieName(id), token!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((interview.inviteExpiresAt.getTime() - Date.now()) / 1000))
  });
  return response;
}
