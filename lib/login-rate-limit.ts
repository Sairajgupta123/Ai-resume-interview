import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getLoginLimit, isLoginWindowExpired, LOGIN_ATTEMPT_RETENTION_MS } from "./login-rate-limit-policy.mjs";

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
  // Bound abandoned username/IP hashes so random login probes cannot grow this table forever.
  await db.loginAttempt.deleteMany({
    where: {
      windowStartedAt: { lt: new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MS) },
      OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }]
    }
  });
  const attempt = await db.loginAttempt.findUnique({ where: { key } });
  const limit = getLoginLimit(attempt, now.getTime());
  if (isLoginWindowExpired(attempt, now.getTime())) {
    await db.loginAttempt.deleteMany({ where: { key } });
  }
  return { key, ...limit };
}

export async function recordFailedLogin(key: string) {
  const now = new Date();
  // Increment in the database to avoid losing concurrent failed attempts.
  await db.loginAttempt.upsert({
    where: { key },
    create: { key, attempts: 1, windowStartedAt: now },
    update: { attempts: { increment: 1 } }
  });
  const updated = await db.loginAttempt.findUnique({ where: { key } });
  if (updated && updated.attempts >= 5 && !updated.blockedUntil) {
    await db.loginAttempt.update({
      where: { key },
      data: { blockedUntil: new Date(now.getTime() + 15 * 60 * 1000) }
    });
  }
}

export async function clearLoginFailures(key: string) {
  await db.loginAttempt.deleteMany({ where: { key } });
}
