import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { buildEmployerAnalytics } from "@/lib/employer-analytics-policy.mjs";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const interviews = await db.interview.findMany({
      select: {
        status: true,
        overallScore: true,
        role: true,
        employerDecision: true,
        createdAt: true
      }
    });
    return NextResponse.json({ analytics: buildEmployerAnalytics(interviews) });
  } catch {
    return NextResponse.json({ error: "Could not load employer analytics." }, { status: 500 });
  }
}
