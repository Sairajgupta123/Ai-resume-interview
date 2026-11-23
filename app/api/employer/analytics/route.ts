import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess, getEmployerSession } from "@/lib/auth";
import { buildEmployerAnalytics } from "@/lib/employer-analytics-policy.mjs";

export const runtime = "nodejs";

export async function GET() {
  const session = await getEmployerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const access = session.kind === "user"
    ? await getEmployerOrganizationAccess("interview:read")
    : null;
  if (session.kind === "user" && !access) {
    return NextResponse.json({ error: "An active single-organization membership with interview read permission is required." }, { status: 403 });
  }
  try {
    const interviews = await db.interview.findMany({
      ...(access ? { where: { organizationId: access.organizationId } } : {}),
      select: { status: true, overallScore: true, role: true, employerDecision: true, createdAt: true }
    });
    return NextResponse.json({ analytics: buildEmployerAnalytics(interviews) }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Could not load employer analytics." }, { status: 500 });
  }
}
