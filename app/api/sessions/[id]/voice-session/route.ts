import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { elapsedInterviewSeconds, INTERVIEW_LIMIT_SECONDS } from "@/lib/interview-policy.mjs";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

// Covers the 15-minute interview plus a small connection/retry margin.
const TOKEN_LIFETIME_SECONDS = 1_200;
const PROVIDER_TIMEOUT_MS = 10_000;

/**
 * Mint a short-lived xAI Realtime credential for the authenticated candidate.
 * The long-lived XAI_API_KEY must never be sent to the browser.
 */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;

  try {
    const candidateToken = getCandidateInvitationToken(request, id);
    const authorized = await hasValidCandidateInvitation(id, candidateToken);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized interview session." }, { status: 401 });
    }

    const interview = await db.interview.findUnique({
      where: { id },
      select: {
        mode: true,
        status: true,
        startedAt: true,
        consentAcceptedAt: true,
        inviteExpiresAt: true
      }
    });

    if (!interview) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }

    if (
      interview.mode !== "live" ||
      interview.status !== "in_progress" ||
      !interview.startedAt ||
      !interview.consentAcceptedAt ||
      !interview.inviteExpiresAt ||
      interview.inviteExpiresAt.getTime() <= Date.now() ||
      elapsedInterviewSeconds(interview.startedAt) >= INTERVIEW_LIMIT_SECONDS
    ) {
      return NextResponse.json({ error: "A consented, active live interview is required." }, { status: 409 });
    }

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Live AI voice is not configured." }, { status: 503 });
    }

    const providerResponse = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        expires_after: { seconds: TOKEN_LIFETIME_SECONDS }
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });

    if (!providerResponse.ok) {
      // Do not forward provider response bodies or credentials to the candidate.
      return NextResponse.json({ error: "Could not initialize secure AI voice. Please retry." }, { status: 502 });
    }

    const payload = await providerResponse.json() as { value?: unknown; expires_at?: unknown };
    if (typeof payload.value !== "string" || !payload.value || typeof payload.expires_at !== "number") {
      return NextResponse.json({ error: "The AI voice provider returned an invalid session credential." }, { status: 502 });
    }

    return NextResponse.json(
      { token: payload.value, expiresAt: payload.expires_at, model: "grok-voice-latest" },
      { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } }
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      { error: timedOut ? "AI voice initialization timed out. Please retry." : "Could not initialize AI voice. Please retry." },
      { status: timedOut ? 504 : 500, headers: { "Cache-Control": "no-store, private" } }
    );
  }
}
