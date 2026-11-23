import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const COST = 1 << 15;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAXMEM = 64 * 1024 * 1024 + 1024;

export async function hashEmployerPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("Employer passwords must contain between 12 and 1024 characters.");
  }
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAXMEM
  });
  return ["scrypt", COST, BLOCK_SIZE, PARALLELIZATION, salt.toString("base64url"), Buffer.from(derived).toString("base64url")].join("$");
}

export async function verifyEmployerPassword(password, encoded) {
  if (typeof password !== "string" || password.length > 1024 || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt"
    || parts[1] !== String(COST) || parts[2] !== String(BLOCK_SIZE)
    || parts[3] !== String(PARALLELIZATION)) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  try {
    const actual = Buffer.from(await scryptAsync(password, salt, KEY_LENGTH, {
      N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAXMEM
    }));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
