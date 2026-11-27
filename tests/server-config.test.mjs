import test from "node:test";
import assert from "node:assert/strict";
import { assertProductionConfig, getProductionConfigErrors } from "../lib/server-config.mjs";

const validProductionEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://interviews.example.com",
  DATABASE_URL: "file:../prod.db",
  EMPLOYER_USERNAME: "mzobs-owner",
  EMPLOYER_PASSWORD: "a-unique-password-with-strong-length",
  SESSION_SECRET: "a-unique-session-secret-with-more-than-32-characters",
  XAI_API_KEY: "xai-production-key",
  S3_ENDPOINT: "https://storage.example.com",
  S3_BUCKET: "private-recordings",
  S3_ACCESS_KEY_ID: "storage-access-key",
  S3_SECRET_ACCESS_KEY: "storage-secret-key"
};

test("development and test environments do not require production secrets", () => {
  assert.deepEqual(getProductionConfigErrors({ NODE_ENV: "development" }), []);
  assert.doesNotThrow(() => assertProductionConfig({ NODE_ENV: "test" }));
});

test("valid production configuration passes", () => {
  assert.deepEqual(getProductionConfigErrors(validProductionEnv), []);
  assert.doesNotThrow(() => assertProductionConfig(validProductionEnv));
});


test("production rejects PostgreSQL URLs until the Prisma provider migration is complete", () => {
  const errors = getProductionConfigErrors({
    ...validProductionEnv,
    DATABASE_URL: "postgresql://app:secret@db.example.com:5432/mzobs"
  });
  assert.ok(errors.some(error => error.includes("Prisma SQLite")));
  assert.throws(
    () => assertProductionConfig({ ...validProductionEnv, DATABASE_URL: "postgresql://app:secret@db.example.com:5432/mzobs" }),
    /PostgreSQL is not supported/
  );
});

test("production startup reports all missing critical configuration together", () => {
  const errors = getProductionConfigErrors({ NODE_ENV: "production" });
  assert.ok(errors.some(error => error.includes("DATABASE_URL")));
  assert.ok(errors.some(error => error.includes("NEXT_PUBLIC_APP_URL")));
  assert.ok(errors.some(error => error.includes("EMPLOYER_USERNAME")));
  assert.ok(errors.some(error => error.includes("EMPLOYER_PASSWORD")));
  assert.ok(errors.some(error => error.includes("SESSION_SECRET")));
  assert.ok(errors.some(error => error.includes("XAI_API_KEY")));
  assert.ok(errors.some(error => error.includes("S3_ENDPOINT")));
  assert.throws(() => assertProductionConfig({ NODE_ENV: "production" }), /Production configuration is incomplete/);
});

test("production rejects default credentials and non-HTTPS recording storage", () => {
  const errors = getProductionConfigErrors({
    ...validProductionEnv,
    EMPLOYER_USERNAME: "admin",
    EMPLOYER_PASSWORD: "change-this-to-a-long-password",
    SESSION_SECRET: "replace-with-a-random-secret-at-least-32-characters-long",
    S3_ENDPOINT: "http://storage.example.com"
  });
  assert.ok(errors.some(error => error.includes("non-default production username")));
  assert.ok(errors.some(error => error.includes("unique password")));
  assert.ok(errors.some(error => error.includes("unique random value")));
  assert.ok(errors.some(error => error.includes("HTTPS")));
});

test("production requires a trusted HTTPS public app origin", () => {
  for (const value of [
    "http://interviews.example.com",
    "https://localhost:3000",
    "https://user:pass@interviews.example.com",
    "https://interviews.example.com/path",
    "https://interviews.example.com/?next=evil",
    "https://interviews.example.com/#fragment",
    "not-a-url"
  ]) {
    const errors = getProductionConfigErrors({ ...validProductionEnv, NEXT_PUBLIC_APP_URL: value });
    assert.ok(errors.some(error => error.includes("NEXT_PUBLIC_APP_URL")), value);
  }
});

test("development may use the local public app URL", () => {
  assert.deepEqual(getProductionConfigErrors({
    NODE_ENV: "development",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000"
  }), []);
});
