import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { elapsedInterviewSeconds, INTERVIEW_LIMIT_SECONDS } from "@/lib/interview-policy.mjs";
import { checkVoiceSessionRateLimit, recordVoiceSessionAttempt } from "@/lib/voice-session-rate-limit";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

// The ephemeral credential is needed only to establish the WebSocket; the active
// Realtime session continues after the credential itself expires.
const TOKEN_LIFETIME_SECONDS = 60;
const PROVIDER_TIMEOUT_MS = 10_000;

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  return NextResponse.json(body, { ...init, headers });
}

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
      return privateJson({ error: "Unauthorized interview session." }, { status: 401 });
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
      return privateJson({ error: "Interview not found." }, { status: 404 });
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
      return privateJson({ error: "A consented, active live interview is required." }, { status: 409 });
    }

    const rateLimit = await checkVoiceSessionRateLimit(request, id);
    if (rateLimit.limited) {
      return privateJson(
        { error: "Too many AI voice connection attempts. Please wait before reconnecting." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    // Count every provider credential request, including provider failures, to
    // prevent a valid candidate session from being used to mint credentials in a loop.
    const attemptLimit = await recordVoiceSessionAttempt(rateLimit.key);
    if (attemptLimit.limited) {
      return privateJson(
        { error: "Too many AI voice connection attempts. Please wait before reconnecting." },
        { status: 429, headers: { "Retry-After": String(attemptLimit.retryAfterSeconds) } }
      );
    }

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return privateJson({ error: "Live AI voice is not configured." }, { status: 503 });
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
      return privateJson({ error: "Could not initialize secure AI voice. Please retry." }, { status: 502 });
    }

    const payload = await providerResponse.json() as { value?: unknown; expires_at?: unknown };
    if (typeof payload.value !== "string" || !payload.value || typeof payload.expires_at !== "number") {
      return privateJson({ error: "The AI voice provider returned an invalid session credential." }, { status: 502 });
    }

    return privateJson(
      { token: payload.value, expiresAt: payload.expires_at, model: "grok-voice-latest" },
      { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } }
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return privateJson(
      { error: timedOut ? "AI voice initialization timed out. Please retry." : "Could not initialize AI voice. Please retry." },
      { status: timedOut ? 504 : 500, headers: { "Cache-Control": "no-store, private" } }
    );
  }
}
