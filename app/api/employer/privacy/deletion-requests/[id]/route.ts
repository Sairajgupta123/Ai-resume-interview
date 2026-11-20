import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { validateDeletionRequestInput } from "@/lib/privacy-deletion-policy.mjs";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

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

export async function POST(request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  try {
    const body = await request.json();
    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, candidateName: true, candidateEmail: true, role: true, status: true }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (interview.status !== "completed") {
      return NextResponse.json({ error: "Deletion requests can only be opened for completed interviews. Active interviews must be closed safely first." }, { status: 409 });
    }
    const validation = validateDeletionRequestInput(body, interview);
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: validation.status });

    const result = await db.$transaction(async tx => {
      const existing = await tx.privacyDeletionRequest.findFirst({
        where: { interviewId: id, status: { in: ["pending_candidate_verification", "verified_pending_approval", "approved_for_deletion", "deletion_in_progress"] } },
        select: { id: true, status: true }
      });
      if (existing) return { duplicate: true, existing };
      const created = await tx.privacyDeletionRequest.create({
        data: {
          interviewId: id,
          candidateNameSnapshot: validation.value.candidateName,
          candidateEmailSnapshot: validation.value.candidateEmail,
          roleSnapshot: validation.value.role,
          reason: validation.value.reason,
          requestedBy: "employer",
          status: "pending_candidate_verification",
          events: {
            create: {
              action: "request_created",
              actor: "employer",
              details: "Employer opened a deletion request after matching the selected candidate record."
            }
          }
        },
        select: { id: true, status: true, createdAt: true }
      });
      return { duplicate: false, created };
    });

    if (result.duplicate) {
      return NextResponse.json({ error: "An active deletion request already exists for this interview.", request: result.existing }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      request: result.created,
      message: "Deletion request recorded. Candidate verification and a separate approval are still required; no candidate data has been deleted."
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not create the privacy deletion request." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
