import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedJson } from "../lib/bounded-json.mjs";

function request(body, headers = {}) {
  return new Request("https://example.test", {
    method: "POST",
    headers,
    body
  });
}

test("reads a bounded JSON object", async () => {
  const result = await readBoundedJson(request('{"username":"admin"}', { "content-type": "application/json" }), 128);
  assert.deepEqual(result, { ok: true, value: { username: "admin" } });
});

test("rejects an oversized declared content length before reading", async () => {
  const result = await readBoundedJson(request('{"a":1}', { "content-length": "129" }), 128);
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test("rejects a streamed body that exceeds the limit", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"'));
      controller.enqueue(new TextEncoder().encode("x".repeat(128)));
      controller.close();
    }
  });
  const result = await readBoundedJson(new Request("https://example.test", { method: "POST", body: stream, duplex: "half" }), 32);
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
});

test("rejects malformed JSON and non-object JSON", async () => {
  assert.equal((await readBoundedJson(request("{"), 128)).status, 400);
  assert.equal((await readBoundedJson(request("[]"), 128)).status, 400);
  assert.equal((await readBoundedJson(request("null"), 128)).status, 400);
});

test("rejects missing body", async () => {
  const result = await readBoundedJson(new Request("https://example.test"), 128);
  assert.equal(result.status, 400);
});
