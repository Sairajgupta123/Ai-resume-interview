import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const requests = await db.privacyDeletionRequest.findMany({
      take: 100,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        interviewId: true,
        candidateNameSnapshot: true,
        candidateEmailSnapshot: true,
        roleSnapshot: true,
        reason: true,
        status: true,
        requestedBy: true,
        createdAt: true,
        updatedAt: true,
        events: { orderBy: { createdAt: "desc" }, take: 10 }
      }
    });
    return NextResponse.json({ requests }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load privacy deletion requests." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
