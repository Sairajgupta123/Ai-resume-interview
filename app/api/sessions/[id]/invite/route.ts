import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitation";
import { replacePendingCandidateInvitation } from "@/lib/invitation-service.mjs";

type Context = { params: Promise<{ id: string }> };

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache"
};

export async function POST(_request: NextRequest, context: Context) {
  try {
    if (!(await isEmployerAuthenticated())) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: PRIVATE_HEADERS });
    }

    const { id } = await context.params;
    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, status: true, startedAt: true, inviteUsedAt: true, invitationTokenHash: true }
    });
    if (!interview) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (interview.status !== "invited" || interview.startedAt || interview.inviteUsedAt || !interview.invitationTokenHash) {
      return NextResponse.json(
        { error: "Only interviews awaiting candidate activity can receive a replacement invitation." },
        { status: 409, headers: PRIVATE_HEADERS }
      );
    }

    const token = createInvitationToken();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    // Compare-and-swap the old hash as well as the lifecycle fields. If two
    // employer requests rotate simultaneously, only one link can be issued.
    const rotated = await replacePendingCandidateInvitation(db, {
      sessionId: id,
      currentTokenHash: interview.invitationTokenHash,
      nextTokenHash: hashInvitationToken(token),
      expiresAt
    });
    if (!rotated) {
      return NextResponse.json(
        { error: "This interview changed while the invitation was being replaced. Refresh before trying again." },
        { status: 409, headers: PRIVATE_HEADERS }
      );
    }

    const configuredBase = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
    const base = configuredBase || new URL(_request.url).origin;
    return NextResponse.json(
      { inviteUrl: `${base}/candidate/${id}?token=${token}`, expiresAt },
      { headers: PRIVATE_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { error: "Invitation service is temporarily unavailable." },
      { status: 503, headers: PRIVATE_HEADERS }
    );
  }
}
