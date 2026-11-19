import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, employerCookieMaxAge, employerCookieName } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    const expectedUser = process.env.EMPLOYER_USERNAME || "admin";
    const expectedPassword = process.env.EMPLOYER_PASSWORD;
    if (!expectedPassword) return NextResponse.json({ error: "Set EMPLOYER_PASSWORD in .env.local before using the employer dashboard." }, { status: 503 });
    if (username !== expectedUser || password !== expectedPassword) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(employerCookieName, createSessionToken(username), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/", maxAge: employerCookieMaxAge
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid login request." }, { status: 400 });
  }
}