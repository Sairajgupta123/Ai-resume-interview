import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess, getEmployerSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getEmployerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const access = session.kind === "user"
    ? await getEmployerOrganizationAccess("audit:read")
    : null;
  if (session.kind === "user" && !access) {
    return NextResponse.json({ error: "An active single-organization membership with audit read permission is required." }, { status: 403 });
  }
  try {
    const interviewScope = access ? { interview: { organizationId: access.organizationId } } : {};
    const [events, recordingEvents] = await Promise.all([
      db.employerDecisionHistory.findMany({
        ...(access ? { where: interviewScope } : {}),
        take: 100,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true, decision: true, notes: true, createdAt: true,
          interview: { select: { id: true, candidateName: true, role: true } }
        }
      }),
      db.recordingAccessEvent.findMany({
        ...(access ? { where: interviewScope } : {}),
        take: 100,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true, method: true, outcome: true, createdAt: true,
          interview: { select: { id: true, candidateName: true, role: true } }
        }
      })
    ]);
    return NextResponse.json({ events, recordingEvents }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Could not load employer audit history." }, { status: 500 });
  }
}
