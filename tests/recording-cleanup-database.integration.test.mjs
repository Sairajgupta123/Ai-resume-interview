import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { enqueueRecordingCleanupTask } from "../lib/recording-cleanup-queue.mjs";

test("recording cleanup tasks persist, deduplicate by object path and use atomic leases", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ai-interview-recording-cleanup-"));
  const databaseUrl = `file:${join(tempDir, "cleanup.db").replaceAll("\\", "/")}`;
  let prisma;
  try {
    execFileSync(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"],
      { cwd: resolve("."), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" }
    );
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    const storedPath = "s3://recordings/123e4567-e89b-12d3-a456-426614174000.webm";
    const enqueued = await enqueueRecordingCleanupTask(prisma, {
      storedPath,
      reason: "recording_replaced",
      now: new Date()
    });
    assert.equal(enqueued, true);
    assert.equal(await enqueueRecordingCleanupTask(prisma, {
      storedPath,
      reason: "duplicate_enqueue"
    }), false);

    const task = await prisma.recordingCleanupTask.findUnique({ where: { storedPath } });
    assert.ok(task);
    assert.equal(task.status, "pending");
    assert.equal(task.attempts, 0);

    const now = new Date();
    const claims = await Promise.all([
      prisma.recordingCleanupTask.updateMany({
        where: { id: task.id, status: "pending", nextAttemptAt: { lte: now } },
        data: { status: "in_progress", attempts: { increment: 1 }, leaseStartedAt: now, leaseToken: "worker-one" }
      }),
      prisma.recordingCleanupTask.updateMany({
        where: { id: task.id, status: "pending", nextAttemptAt: { lte: now } },
        data: { status: "in_progress", attempts: { increment: 1 }, leaseStartedAt: now, leaseToken: "worker-two" }
      })
    ]);
    assert.deepEqual(claims.map(claim => claim.count).sort(), [0, 1]);

    const claimed = await prisma.recordingCleanupTask.findUnique({ where: { id: task.id } });
    assert.equal(claimed.status, "in_progress");
    assert.equal(claimed.attempts, 1);
    assert.ok(["worker-one", "worker-two"].includes(claimed.leaseToken));
  } finally {
    if (prisma) await prisma.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
  }
});
