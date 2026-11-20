import test from "node:test";
import assert from "node:assert/strict";
import { rotateCandidateInvitationToken } from "../lib/invitation-service.mjs";

const now = new Date("2026-11-20T12:00:00.000Z");

test("rotates the invitation hash and marks the emailed link as consumed atomically", async () => {
  let call;
  const db = {
    interview: {
      async updateMany(args) {
        call = args;
        return { count: 1 };
      }
    }
  };
  const result = await rotateCandidateInvitationToken(db, {
    sessionId: "interview-1",
    currentTokenHash: "old-hash",
    sessionTokenHash: "new-session-hash",
    now
  });
  assert.equal(result, true);
  assert.deepEqual(call.where, {
    id: "interview-1",
    invitationTokenHash: "old-hash",
    status: "invited",
    startedAt: null,
    inviteUsedAt: null,
    inviteExpiresAt: { gt: now }
  });
  assert.deepEqual(call.data, {
    invitationTokenHash: "new-session-hash",
    inviteUsedAt: now
  });
});

test("rejects replay when the atomic consume-and-rotate update loses the race", async () => {
  const db = { interview: { async updateMany() { return { count: 0 }; } } };
  assert.equal(await rotateCandidateInvitationToken(db, {
    sessionId: "interview-1",
    currentTokenHash: "old-hash",
    sessionTokenHash: "new-session-hash",
    now
  }), false);
});

test("rejects incomplete or invalid rotation input without touching the database", async () => {
  let called = false;
  const db = { interview: { async updateMany() { called = true; return { count: 1 }; } } };
  assert.equal(await rotateCandidateInvitationToken(db, {
    sessionId: "",
    currentTokenHash: "old-hash",
    sessionTokenHash: "new-session-hash",
    now
  }), false);
  assert.equal(await rotateCandidateInvitationToken(db, {
    sessionId: "interview-1",
    currentTokenHash: "old-hash",
    sessionTokenHash: "new-session-hash",
    now: new Date("invalid")
  }), false);
  assert.equal(called, false);
});
