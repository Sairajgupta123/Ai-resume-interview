import { NextResponse } from "next/server";
import { isEmployerAuthenticated } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(
    { authenticated: await isEmployerAuthenticated() },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
