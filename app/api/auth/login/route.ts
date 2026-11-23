import { NextRequest, NextResponse } from "next/server";
import {
  createEmployerUserSessionToken,
  createSessionToken,
  employerCookieMaxAge,
  employerCookieName
} from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyEmployerPassword } from "@/lib/employer-password.mjs";
import { clearLoginFailures, loginRateLimit, recordFailedLogin } from "@/lib/login-rate-limit";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || username.length > 160 || password.length > 1024) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    const limit = await loginRateLimit(request, username);
    if (limit.limited) {
      return NextResponse.json(
        { error: "Too many failed login attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } }
      );
    }

    // Once any individual employer account exists, the shared environment-variable
    // login is disabled. This prevents old shared credentials from bypassing identity.
    const employerUserCount = await db.employerUser.count();
    if (employerUserCount > 0) {
      const user = await db.employerUser.findUnique({
        where: { username },
        select: {
          id: true,
          username: true,
          passwordHash: true,
          sessionVersion: true,
          disabledAt: true,
          memberships: { select: { id: true } }
        }
      });
      const validPassword = user
        ? await verifyEmployerPassword(password, user.passwordHash)
        : false;
      if (!user || !validPassword || user.disabledAt || user.memberships.length === 0) {
        await recordFailedLogin(limit.key);
        return NextResponse.json({ error: "Invalid username or password." }, {
          status: 401,
          headers: { "Cache-Control": "no-store" }
        });
      }

      await clearLoginFailures(limit.key);
      const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
      response.cookies.set(employerCookieName, createEmployerUserSessionToken({
        userId: user.id,
        sessionVersion: user.sessionVersion
      }), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: employerCookieMaxAge
      });
      return response;
    }

    // Temporary single-employer fallback while no database-backed account exists.
    const expectedUser = process.env.EMPLOYER_USERNAME || "admin";
    const expectedPassword = process.env.EMPLOYER_PASSWORD;
    if (!expectedPassword) {
      return NextResponse.json({ error: "Employer login is not configured." }, { status: 503 });
    }
    if (username !== expectedUser || password !== expectedPassword) {
      await recordFailedLogin(limit.key);
      return NextResponse.json({ error: "Invalid username or password." }, {
        status: 401,
        headers: { "Cache-Control": "no-store" }
      });
    }

    await clearLoginFailures(limit.key);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(employerCookieName, createSessionToken(username), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: employerCookieMaxAge
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Login service is temporarily unavailable." }, { status: 503 });
  }
}
