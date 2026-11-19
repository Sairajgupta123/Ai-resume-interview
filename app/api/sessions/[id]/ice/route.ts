import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { hasValidCandidateInvitation } from "@/lib/invitation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const employer = await isEmployerAuthenticated();
  const candidateToken = request.headers.get("x-interview-invite");
  const candidate = !employer && await hasValidCandidateInvitation(id, candidateToken);
  if (!employer && !candidate) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const interview = await db.interview.findUnique({ where: { id }, select: { mode: true, status: true, startedAt: true, consentAcceptedAt: true } });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (interview.mode !== "live" || interview.status !== "in_progress" || !interview.startedAt || !interview.consentAcceptedAt) {
    return NextResponse.json({ error: "Live interview is not active or candidate consent has not been recorded." }, { status: 409 });
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

  return NextResponse.json({ iceServers }, {
    headers: { "Cache-Control": "no-store, private" }
  });
}
