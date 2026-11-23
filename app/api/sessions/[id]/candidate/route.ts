import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { candidateInvitationCookieName, exchangeCandidateInvitation, getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";

type Context = { params: Promise<{ id: string }> };

async function candidateResponse(id: string, token: string | null, exchange = false) {
  // Load the response data before consuming the one-time link. If the database
  // read fails, the candidate can retry with the original invitation URL.
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

  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (interview.status === "completed") return NextResponse.json({ error: "This interview has already been completed." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (!interview.inviteExpiresAt || interview.inviteExpiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "This interview invitation has expired." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const sessionToken = exchange ? await exchangeCandidateInvitation(id, token) : token;
  const authorized = exchange
    ? Boolean(sessionToken)
    : await hasValidCandidateInvitation(id, sessionToken);
  if (!authorized || !sessionToken) {
    return NextResponse.json({ error: "This interview invitation is invalid or expired. Contact the employer for a new link." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const { recordingPath, ...candidateInterview } = interview;
  const response = NextResponse.json({
    interview: { ...candidateInterview, recordingSaved: Boolean(recordingPath) }
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  response.cookies.set(candidateInvitationCookieName(id), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((interview.inviteExpiresAt.getTime() - Date.now()) / 1000))
  });
  return response;
}

// Exchange the one-time link token in a small request body, never in the URL.
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "A JSON invitation token is required." }, { status: 415, headers });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 4_096) {
    return NextResponse.json({ error: "Invitation request is too large." }, { status: 413, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Invitation token is required." }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > 4_096) {
        await reader.cancel();
        return NextResponse.json({ error: "Invitation request is too large." }, { status: 413, headers });
      }
      chunks.push(chunk.value);
    }
  } catch {
    return NextResponse.json({ error: "Could not read invitation request." }, { status: 400, headers });
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let token: string | null = null;
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid invitation request." }, { status: 400, headers });
    }
    token = "token" in body && typeof body.token === "string" ? body.token : null;
  } catch {
    return NextResponse.json({ error: "Invalid invitation request." }, { status: 400, headers });
  }
  if (!token || token.length < 32 || token.length > 256) {
    return NextResponse.json({ error: "Invalid or expired invitation token." }, { status: 401, headers });
  }
  return candidateResponse(id, token, true);
}

// Refresh recovery uses only the HttpOnly cookie; bearer tokens are never accepted in query parameters.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return candidateResponse(id, getCandidateInvitationToken(request, id));
}
