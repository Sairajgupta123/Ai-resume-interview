import { createHash } from "node:crypto";
import { db } from "@/lib/db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60 * 1000;

function requestIdentity(request: Request, username: string) {
  // Configure the production proxy to overwrite these headers with the real client IP.
  const ip = request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return createHash("sha256").update(ip + "\n" + username.trim().toLowerCase()).digest("hex");
}

export async function loginRateLimit(request: Request, username: string) {
  const key = requestIdentity(request, username);
  const now = new Date();
  const attempt = await db.loginAttempt.findUnique({ where: { key } });
  if (!attempt) return { key, limited: false, retryAfterSeconds: 0 };
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    return {
      key,
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((attempt.blockedUntil.getTime() - now.getTime()) / 1000))
    };
  }
  if (now.getTime() - attempt.windowStartedAt.getTime() >= WINDOW_MS) {
    await db.loginAttempt.deleteMany({ where: { key } });
  }
  return { key, limited: false, retryAfterSeconds: 0 };
}

export async function recordFailedLogin(key: string) {
  const now = new Date();
  const existing = await db.loginAttempt.findUnique({ where: { key } });
  if (!existing || now.getTime() - existing.windowStartedAt.getTime() >= WINDOW_MS) {
    await db.loginAttempt.upsert({
      where: { key },
      create: { key, attempts: 1, windowStartedAt: now },
      update: { attempts: 1, windowStartedAt: now, blockedUntil: null }
    });
    return;
  }
  const attempts = existing.attempts + 1;
  await db.loginAttempt.update({
    where: { key },
    data: { attempts, blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + BLOCK_MS) : null }
  });
}

export async function clearLoginFailures(key: string) {
  await db.loginAttempt.deleteMany({ where: { key } });
}
