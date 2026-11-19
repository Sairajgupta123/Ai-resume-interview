import { NextResponse } from "next/server";
import { isEmployerAuthenticated } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({ authenticated: await isEmployerAuthenticated() });
}