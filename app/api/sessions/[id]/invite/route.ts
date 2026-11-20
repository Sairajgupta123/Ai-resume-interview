import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitation";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const interview = await db.interview.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  if (interview.status === "completed") return NextResponse.json({ error: "Completed interviews cannot be invited again." }, { status: 409 });
  const token = createInvitationToken();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  await db.interview.update({ where: { id }, data: {
    invitationTokenHash: hashInvitationToken(token),
    inviteExpiresAt: expiresAt,
    inviteUsedAt: null
  } });
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(_request.url).origin;
  return NextResponse.json(
    { inviteUrl: `${base}/candidate/${id}?token=${token}`, expiresAt },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
