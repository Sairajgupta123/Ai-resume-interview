import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { isInterviewTimeLimitReached } from "@/lib/interview-policy.mjs";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache"
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const employer = await isEmployerAuthenticated();
    const candidateToken = getCandidateInvitationToken(request, id);
    const candidate = !employer && await hasValidCandidateInvitation(id, candidateToken);
    if (!employer && !candidate) return privateJson({ error: "Unauthorized." }, 401);

    const interview = await db.interview.findUnique({
      where: { id },
      select: { mode: true, status: true, startedAt: true, consentAcceptedAt: true }
    });
    if (!interview) return privateJson({ error: "Interview not found." }, 404);
    if (interview.mode !== "live" || interview.status === "completed" ||
      (interview.startedAt && isInterviewTimeLimitReached(interview.startedAt))) {
      return privateJson({ error: "Live interview is not active." }, 409);
    }

    // Employers may prepare their peer connection while waiting. Candidate ICE
    // credentials are issued only after consent and interview start are persisted.
    if (candidate && (!interview.startedAt || !interview.consentAcceptedAt || interview.status !== "in_progress")) {
      return privateJson({ error: "Candidate consent is required before joining live video." }, 409);
    }

    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    const urls = process.env.TURN_URL?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
    const secret = process.env.TURN_SHARED_SECRET;
    if (urls.length && secret) {
      const ttl = Math.min(Math.max(Number(process.env.TURN_CREDENTIAL_TTL_SECONDS) || 3600, 300), 86400);
      const username = `${Math.floor(Date.now() / 1000) + ttl}:${id}`;
      const credential = createHmac("sha1", secret).update(username).digest("base64");
      iceServers.push({ urls, username, credential });
    }

    return privateJson({ iceServers });
  } catch {
    return privateJson({ error: "Could not load live video connection settings." }, 503);
  }
}
