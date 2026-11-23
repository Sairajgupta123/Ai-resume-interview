import { NextResponse } from "next/server";
import { getEmployerSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getEmployerSession();
    return NextResponse.json(
      session
        ? {
            authenticated: true,
            accountType: session.kind,
            username: session.username,
            ...(session.kind === "user" ? {
              userId: session.userId,
              displayName: session.displayName,
              organizations: session.memberships
            } : {})
          }
        : { authenticated: false },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json({ authenticated: false }, {
      status: 503,
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  }
}
