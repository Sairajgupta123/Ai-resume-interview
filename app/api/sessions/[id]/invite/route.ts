import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitation";

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
    const interview = await db.interview.findUnique({ where: { id }, select: { id: true, status: true, startedAt: true, inviteUsedAt: true } });
    if (!interview) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (interview.status !== "invited" || interview.startedAt || interview.inviteUsedAt) {
      return NextResponse.json(
        { error: "Only interviews awaiting candidate activity can receive a replacement invitation." },
        { status: 409, headers: PRIVATE_HEADERS }
      );
    }

    const token = createInvitationToken();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    // Make the status check and token rotation atomic. A candidate starting
    // concurrently must not have their active browser session invalidated.
    const rotated = await db.interview.updateMany({
      where: { id, status: "invited", startedAt: null, inviteUsedAt: null },
      data: {
        invitationTokenHash: hashInvitationToken(token),
        inviteExpiresAt: expiresAt,
        inviteUsedAt: null
      }
    });
    if (rotated.count !== 1) {
      return NextResponse.json(
        { error: "This interview is no longer awaiting a candidate. Refresh before issuing another invitation." },
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
