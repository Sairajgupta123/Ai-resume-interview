import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { buildRetentionPreview } from "@/lib/retention-policy.mjs";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const records = await db.interview.findMany({
      select: {
        status: true,
        createdAt: true,
        consentAcceptedAt: true,
        consentVersion: true
      }
    });
    const preview = buildRetentionPreview(records, process.env.INTERVIEW_RETENTION_DAYS);
    return NextResponse.json(
      { preview },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not generate the retention preview." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
