import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitation";

const MAX_REQUEST_BYTES = 40_000;
const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;

async function readJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return null;

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return null;

  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function requiredText(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export async function POST(request: NextRequest) {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await readJsonBody(request);
  if (!body) {
    return NextResponse.json(
      { error: "Send a valid JSON request smaller than 40 KB." },
      { status: 400 }
    );
  }

  const candidateName = requiredText(body, "candidateName", 160);
  const candidateEmail = requiredText(body, "candidateEmail", 254)?.toLowerCase();
  const role = requiredText(body, "role", 160);
  const resume = requiredText(body, "resume", 20_000);
  const jobDescription = requiredText(body, "jobDescription", 16_000);
  const mode = body.mode === "recorded" ? "recorded" : body.mode === "live" ? "live" : null;

  if (!candidateName || !candidateEmail || !role || !resume || !jobDescription || !mode) {
    return NextResponse.json(
      { error: "Provide a valid candidate name, email, role, resume, job description and interview format." },
      { status: 400 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
    return NextResponse.json({ error: "Enter a valid candidate email." }, { status: 400 });
  }

  const candidateToken = createInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
  try {
    const interview = await db.interview.create({
      data: {
        candidateName,
        candidateEmail,
        role,
        mode,
        status: "invited",
        resumeText: resume,
        jobDescription,
        invitationTokenHash: hashInvitationToken(candidateToken),
        inviteExpiresAt: expiresAt
      },
      select: { id: true, createdAt: true }
    });

    const configuredBase = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
    const base = configuredBase || new URL(request.url).origin;
    return NextResponse.json(
      {
        id: interview.id,
        createdAt: interview.createdAt,
        inviteUrl: `${base}/candidate/${interview.id}?token=${candidateToken}`,
        expiresAt
      },
      {
        status: 201,
        headers: { "Cache-Control": "private, no-store, max-age=0" }
      }
    );
  } catch {
    return NextResponse.json({ error: "Could not create candidate interview and invitation." }, { status: 500 });
  }
}
