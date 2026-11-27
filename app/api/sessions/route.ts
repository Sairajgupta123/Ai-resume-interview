import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitation";
import { readBoundedJson } from "@/lib/bounded-json.mjs";

const MAX_REQUEST_BYTES = 40_000;
const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function requiredText(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export async function POST(request: NextRequest) {
  // Legacy creation endpoint retained for compatibility. Keep its request
  // handling bounded just like the current employer invitation endpoint.
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: privateHeaders });
  }
  if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "A JSON interview request is required." }, { status: 415, headers: privateHeaders });
  }

  const parsed = await readBoundedJson(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  }

  const body = parsed.value;
  const candidateName = requiredText(body, "candidateName", 160);
  const role = requiredText(body, "role", 160);
  const resume = requiredText(body, "resume", 20_000);
  const jobDescription = requiredText(body, "jobDescription", 16_000);
  const mode = body.mode === "recorded" ? "recorded" : body.mode === "live" || body.mode === undefined ? "live" : null;

  if (!candidateName || !role || !resume || !jobDescription || !mode) {
    return NextResponse.json(
      { error: "Provide a valid candidate name, role, resume, job description and interview format." },
      { status: 400, headers: privateHeaders }
    );
  }

  const candidateToken = createInvitationToken();
  try {
    const interview = await db.interview.create({
      data: {
        candidateName,
        role,
        mode,
        status: "invited",
        resumeText: resume,
        jobDescription,
        invitationTokenHash: hashInvitationToken(candidateToken),
        inviteExpiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS)
      },
      select: { id: true, createdAt: true }
    });
    return NextResponse.json(
      { ...interview, inviteToken: candidateToken },
      { status: 201, headers: privateHeaders }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not save interview. Check database setup." },
      { status: 500, headers: privateHeaders }
    );
  }
}

export async function GET() {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: privateHeaders });
  }
  try {
    const interviews = await db.interview.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, candidateName: true, role: true, mode: true, status: true,
        overallScore: true, recommendation: true, employerDecision: true,
        durationSeconds: true, createdAt: true
      }
    });
    return NextResponse.json({ interviews }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "Could not load employer interviews." }, { status: 500, headers: privateHeaders });
  }
}