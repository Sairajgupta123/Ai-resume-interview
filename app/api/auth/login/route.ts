import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, employerCookieMaxAge, employerCookieName } from "@/lib/auth";
import { clearLoginFailures, loginRateLimit, recordFailedLogin } from "@/lib/login-rate-limit";
import { readBoundedJson } from "@/lib/bounded-json.mjs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };

export async function POST(request: NextRequest) {
  try {
    const contentType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415, headers: PRIVATE_HEADERS });
    }
    const parsed = await readBoundedJson(request, 8 * 1024);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: PRIVATE_HEADERS });
    const body = parsed.value;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const expectedUser = process.env.EMPLOYER_USERNAME || "admin";
    const expectedPassword = process.env.EMPLOYER_PASSWORD;

    if (!expectedPassword) return NextResponse.json({ error: "Employer login is not configured." }, { status: 503, headers: PRIVATE_HEADERS });
    if (!username || username.length > 160 || password.length > 1024) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401, headers: PRIVATE_HEADERS });
    }

    const limit = await loginRateLimit(request, username);
    if (limit.limited) {
      return NextResponse.json(
        { error: "Too many failed login attempts. Please wait before trying again." },
        { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    if (username !== expectedUser || password !== expectedPassword) {
      await recordFailedLogin(limit.key);
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401, headers: PRIVATE_HEADERS });
    }

    await clearLoginFailures(limit.key);
    const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
    response.cookies.set(employerCookieName, createSessionToken(username), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/", maxAge: employerCookieMaxAge
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Login service is temporarily unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
