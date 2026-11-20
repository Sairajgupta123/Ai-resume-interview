import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 },);
  }
  try {
    const [events, recordingEvents] = await Promise.all([
      db.employerDecisionHistory.findMany({
        take: 100,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          decision: true,
          notes: true,
          createdAt: true,
          interview: { select: { id: true, candidateName: true, role: true } }
        }
      }),
      db.recordingAccessEvent.findMany({
        take: 100,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          method: true,
          outcome: true,
          createdAt: true,
          interview: { select: { id: true, candidateName: true, role: true } }
        }
      })
    ]);
    return NextResponse.json(
      { events, recordingEvents },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not load employer audit history." }, { status: 500 });
  }
}
