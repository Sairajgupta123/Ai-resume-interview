import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import {
  getVoiceSessionLimit,
  isVoiceSessionWindowExpired,
  VOICE_SESSION_BLOCK_MS,
  VOICE_SESSION_MAX_ATTEMPTS,
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
  const attempt = await db.loginAttempt.findUnique({ where: { key } });
  if (isVoiceSessionWindowExpired(attempt, now.getTime())) {
    await db.loginAttempt.deleteMany({ where: { key } });
  }
  return { key, ...getVoiceSessionLimit(attempt, now.getTime()) };
}

export async function recordVoiceSessionAttempt(key: string) {
  const now = new Date();
  await db.loginAttempt.upsert({
    where: { key },
    create: { key, attempts: 1, windowStartedAt: now },
    update: { attempts: { increment: 1 } }
  });
  const updated = await db.loginAttempt.findUnique({ where: { key } });
  if (updated && updated.attempts >= VOICE_SESSION_MAX_ATTEMPTS && !updated.blockedUntil) {
    await db.loginAttempt.update({
      where: { key },
      data: { blockedUntil: new Date(now.getTime() + VOICE_SESSION_BLOCK_MS) }
    });
  }
}
