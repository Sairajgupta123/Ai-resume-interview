import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteStoredInterviewRecording } from "../lib/deletion-storage.mjs";

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY
};

function setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreEnv() {
  setEnv(originalEnv);
}

test("storage deletion handles empty and unsupported references safely", async () => {
  await assert.doesNotReject(() => deleteStoredInterviewRecording(null));
  await assert.doesNotReject(() => deleteStoredInterviewRecording(""));
  await assert.rejects(
    () => deleteStoredInterviewRecording("../../.env"),
    { message: "UNSUPPORTED_RECORDING_REFERENCE" }
  );
  await assert.rejects(
    () => deleteStoredInterviewRecording("s3://other-bucket/private.mp4"),
    { message: "UNSUPPORTED_RECORDING_REFERENCE" }
  );
});

test("local recording deletion removes only the generated recording file and is idempotent", async () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const relativePath = `data/recordings/${id}.webm`;
  const directory = join(process.cwd(), "data", "recordings");
  const absolutePath = join(directory, `${id}.webm`);

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, "dummy test recording");

  try {
    assert.equal(await readFile(absolutePath, "utf8"), "dummy test recording");
    await deleteStoredInterviewRecording(relativePath);
    await assert.rejects(() => readFile(absolutePath), { code: "ENOENT" });
    await assert.doesNotReject(() => deleteStoredInterviewRecording(relativePath));
  } finally {
    await rm(absolutePath, { force: true });
  }
});

test("S3 deletion signs a private path-style DELETE request", async () => {
  const originalFetch = globalThis.fetch;
  setEnv({
    NODE_ENV: "test",
    S3_ENDPOINT: "https://storage.example.test",
    S3_BUCKET: "private-recordings",
    S3_REGION: "auto",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key"
  });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(null, { status: 204 });
  };

  try {
    await deleteStoredInterviewRecording("s3://recordings/123e4567-e89b-12d3-a456-426614174000.webm");
    assert.equal(captured.options.method, "DELETE");
    assert.equal(captured.url, "https://storage.example.test/private-recordings/recordings/123e4567-e89b-12d3-a456-426614174000.webm");
    assert.match(captured.options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access-key\//);
    assert.equal(captured.options.headers.host, "storage.example.test");
    assert.equal(captured.options.cache, "no-store");
    assert.equal(captured.options.redirect, "error");
    assert.ok(captured.options.signal instanceof AbortSignal);
    assert.equal(captured.options.signal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("S3 missing objects are treated as already deleted", async () => {
  const originalFetch = globalThis.fetch;
  setEnv({
    NODE_ENV: "test",
    S3_ENDPOINT: "https://storage.example.test",
    S3_BUCKET: "private-recordings",
    S3_REGION: "auto",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key"
  });
  globalThis.fetch = async () => new Response(null, { status: 404 });

  try {
    await assert.doesNotReject(() =>
      deleteStoredInterviewRecording("s3://recordings/123e4567-e89b-12d3-a456-426614174000.mp4")
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("S3 configuration and remote failures never silently succeed", async () => {
  const originalFetch = globalThis.fetch;
  setEnv({
    NODE_ENV: "test",
    S3_ENDPOINT: undefined,
    S3_BUCKET: undefined,
    S3_REGION: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined
  });

  try {
    await assert.rejects(
      () => deleteStoredInterviewRecording("s3://recordings/123e4567-e89b-12d3-a456-426614174000.mov"),
      { message: "STORAGE_NOT_CONFIGURED" }
    );

    setEnv({
      S3_ENDPOINT: "https://storage.example.test",
      S3_BUCKET: "private-recordings",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key"
    });
    globalThis.fetch = async () => new Response(null, { status: 500 });
    await assert.rejects(
      () => deleteStoredInterviewRecording("s3://recordings/123e4567-e89b-12d3-a456-426614174000.mov"),
      { message: "REMOTE_RECORDING_DELETE_FAILED" }
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
