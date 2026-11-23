import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: PRIVATE_HEADERS });
  }
  try {
    const events = await db.employerDecisionHistory.findMany({
      take: 100,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        decision: true,
        notes: true,
        createdAt: true,
        interview: { select: { id: true, candidateName: true, role: true } }
      }
    });
    return NextResponse.json(
      { events },
      { headers: PRIVATE_HEADERS }
    );
  } catch {
    return NextResponse.json({ error: "Could not load employer audit history." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
