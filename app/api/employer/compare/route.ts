import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess, getEmployerSession } from "@/lib/auth";
import { buildCandidateComparison } from "@/lib/candidate-comparison-policy.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getEmployerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const access = session.kind === "user"
    ? await getEmployerOrganizationAccess("interview:read")
    : null;
  if (session.kind === "user" && !access) return NextResponse.json({ error: "An active single-organization membership with interview read permission is required." }, { status: 403 });
  try {
    const body = await request.json();
    const rawIds: unknown[] = Array.isArray(body?.interviewIds) ? body.interviewIds : [];
    const ids: string[] = Array.from(new Set<string>(
      rawIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    ));
    if (ids.length < 2 || ids.length > 3) {
      return NextResponse.json({ error: "Select between two and three candidates." }, { status: 400 });
    }
    const interviews = await db.interview.findMany({
      where: { id: { in: ids }, status: "completed", ...(access ? { organizationId: access.organizationId } : {}) },
      select: {
        id: true, candidateName: true, role: true, overallScore: true,
        recommendation: true, reportJson: true
      }
    });
    if (interviews.length !== ids.length) {
      return NextResponse.json({ error: "One or more selected interviews are unavailable or incomplete." }, { status: 404 });
    }
    const result = buildCandidateComparison(interviews);
    return NextResponse.json({ comparison: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Select") || message.startsWith("Every selected")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not compare the selected candidates." }, { status: 500 });
  }
}
