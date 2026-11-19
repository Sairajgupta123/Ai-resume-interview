import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "mzobs_employer_session";
const MAX_AGE = 60 * 60 * 12;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

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
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = Date.now() - Number(timestamp);
  return username === (process.env.EMPLOYER_USERNAME || "admin") && age >= 0 && age < MAX_AGE * 1000;
}

export async function isEmployerAuthenticated() {
  const jar = await cookies();
  return verifySessionToken(jar.get(COOKIE)?.value);
}

export const employerCookieName = COOKIE;
export const employerCookieMaxAge = MAX_AGE;
