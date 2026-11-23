import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { EMPLOYER_SESSION_MAX_AGE_SECONDS, isSessionTimestampValid } from "./session-policy.mjs";
import { isEmployerUserSessionPayload } from "./employer-session-policy.mjs";
import { hasEmployerPermission, normalizeEmployerRole } from "./employer-access-policy.mjs";

const COOKIE = "mzobs_employer_session";
const MAX_AGE = EMPLOYER_SESSION_MAX_AGE_SECONDS;

type EmployerMembershipContext = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
};

export type EmployerSession =
  | { kind: "legacy"; username: string; memberships: [] }
  | {
      kind: "user";
      userId: string;
      username: string;
      displayName: string | null;
      sessionVersion: number;
      memberships: EmployerMembershipContext[];
    };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeSignatureEquals(signature: string, expected: string) {
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Legacy shared-account session format. Kept only until the first database-backed
// employer user is provisioned; after that, old shared sessions are rejected.
export function createSessionToken(username: string) {
  const payload = `${username}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [username, timestamp, signature] = parts;
  const payload = `${username}.${timestamp}`;
  if (!safeSignatureEquals(signature, sign(payload))) return false;
  return username === (process.env.EMPLOYER_USERNAME || "admin")
    && isSessionTimestampValid(timestamp, Date.now(), MAX_AGE);
}

export function createEmployerUserSessionToken(input: {
  userId: string;
  sessionVersion: number;
}) {
  const payload = Buffer.from(JSON.stringify({
    v: 2,
    sub: input.userId,
    sv: input.sessionVersion,
    iat: Date.now()
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyEmployerUserSessionToken(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!safeSignatureEquals(signature, sign(encodedPayload))) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!isEmployerUserSessionPayload(payload, Date.now(), MAX_AGE)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getEmployerSession(): Promise<EmployerSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const userPayload = verifyEmployerUserSessionToken(token);
  if (userPayload) {
    const user = await db.employerUser.findUnique({
      where: { id: userPayload.sub },
      select: {
        id: true,
        username: true,
        displayName: true,
        disabledAt: true,
        sessionVersion: true,
        memberships: {
          select: {
            role: true,
            organization: { select: { id: true, name: true, slug: true } }
          }
        }
      }
    });
    if (!user || user.disabledAt || user.sessionVersion !== userPayload.sv) return null;
    const memberships = user.memberships.flatMap((membership) => {
      const role = normalizeEmployerRole(membership.role);
      if (!role) return [];
      return [{
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        organizationSlug: membership.organization.slug,
        role
      }];
    });
    if (memberships.length === 0) return null;
    return {
      kind: "user",
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      sessionVersion: user.sessionVersion,
      memberships
    };
  }

  // Fail closed for the old shared login as soon as any database-backed user exists.
  const employerUserCount = await db.employerUser.count();
  if (employerUserCount > 0 || !verifySessionToken(token)) return null;
  return {
    kind: "legacy",
    username: process.env.EMPLOYER_USERNAME || "admin",
    memberships: []
  };
}

export async function getEmployerOrganizationAccess(permission: string) {
  const session = await getEmployerSession();
  if (!session || session.kind !== "user" || session.memberships.length !== 1) return null;
  const membership = session.memberships[0];
  if (!hasEmployerPermission(membership.role, permission)) return null;
  return {
    userId: session.userId,
    organizationId: membership.organizationId,
    role: membership.role
  };
}

export async function isEmployerAuthenticated() {
  return (await getEmployerSession()) !== null;
}

export const employerCookieName = COOKIE;
export const employerCookieMaxAge = MAX_AGE;
