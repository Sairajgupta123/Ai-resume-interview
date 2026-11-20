import { NextResponse } from "next/server";
import { employerCookieName } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
  response.cookies.set(employerCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    sameSite: "lax"
  });
  return response;
}
