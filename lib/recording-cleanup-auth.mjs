import { timingSafeEqual } from "node:crypto";

export function isAuthorizedRecordingCleanupRequest(request, secret) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
