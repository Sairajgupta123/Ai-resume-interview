import test from "node:test";
import assert from "node:assert/strict";
import { hashEmployerPassword, verifyEmployerPassword } from "../lib/employer-password.mjs";

test("hashes passwords with a salted scrypt encoding and verifies the password", async () => {
  const hash = await hashEmployerPassword("correct horse battery staple");
  assert.match(hash, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(hash, await hashEmployerPassword("correct horse battery staple"));
  assert.equal(await verifyEmployerPassword("correct horse battery staple", hash), true);
});

test("rejects incorrect passwords and malformed encodings", async () => {
  const hash = await hashEmployerPassword("correct horse battery staple");
  assert.equal(await verifyEmployerPassword("wrong password", hash), false);
  assert.equal(await verifyEmployerPassword("correct horse battery staple", "not-a-hash"), false);
  assert.equal(await verifyEmployerPassword("correct horse battery staple", hash.replace("32768", "1024")), false);
});

test("enforces password length limits before hashing", async () => {
  await assert.rejects(() => hashEmployerPassword("short"), /between 12 and 1024/);
  await assert.rejects(() => hashEmployerPassword("x".repeat(1025)), /between 12 and 1024/);
});
