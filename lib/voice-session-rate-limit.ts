import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import {
  getVoiceSessionLimit,
  getVoiceSessionAttemptDecision,
  isVoiceSessionWindowExpired,
  VOICE_SESSION_BLOCK_MS,
  VOICE_SESSION_WINDOW_MS
} from "./voice-session-rate-limit-policy.mjs";

function requestKey(request: Request, interviewId: string) {
  // The production proxy must overwrite these headers with the actual client IP.
  const ip = request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return createHash("sha256").update("voice-session\n" + ip + "\n" + interviewId).digest("hex");
}

export async function checkVoiceSessionRateLimit(request: Request, interviewId: string) {
  const key = requestKey(request, interviewId);
  const now = new Date();
  // Reuse the existing attempt table, and prune expired rows so anonymous
  // invitation probes cannot make the table grow indefinitely.
  await db.loginAttempt.deleteMany({
    where: {
      windowStartedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }]
    }
  });
  const attempt = await db.loginAttempt.findUnique({ where: { key } });
  if (isVoiceSessionWindowExpired(attempt, now.getTime())) {
    await db.loginAttempt.deleteMany({
      where: { key, windowStartedAt: { lt: new Date(now.getTime() - VOICE_SESSION_WINDOW_MS) } }
    });
  }
  return { key, ...getVoiceSessionLimit(attempt, now.getTime()) };
}

export async function recordVoiceSessionAttempt(key: string) {
  const now = new Date();
  // Use the atomic upsert result as the reservation number. Checking first and
  // incrementing later would let concurrent requests all pass the same limit.
  const updated = await db.loginAttempt.upsert({
    where: { key },
    create: { key, attempts: 1, windowStartedAt: now },
    update: { attempts: { increment: 1 } }
  });
  const decision = getVoiceSessionAttemptDecision(updated.attempts);
  if (decision.shouldBlock && !updated.blockedUntil) {
    await db.loginAttempt.update({
      where: { key },
      data: { blockedUntil: new Date(now.getTime() + VOICE_SESSION_BLOCK_MS) }
    });
  }
  if (decision.limited) {
    return { limited: true, retryAfterSeconds: Math.ceil(VOICE_SESSION_BLOCK_MS / 1000) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}
