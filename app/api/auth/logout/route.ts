import { NextResponse } from "next/server";
import { employerCookieName } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(employerCookieName, "", { httpOnly: true, path: "/", maxAge: 0, sameSite: "lax" });
  return response;
}