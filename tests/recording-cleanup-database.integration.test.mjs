import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { enqueueRecordingCleanupTask } from "../lib/recording-cleanup-queue.mjs";
import { processRecordingCleanupBatch } from "../lib/recording-cleanup-worker.mjs";

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

    // Exercise the actual worker against SQLite: an unreferenced object is
    // deleted, while an object still referenced by an interview is preserved.
    await prisma.recordingCleanupTask.update({
      where: { id: task.id },
      data: { status: "pending", leaseStartedAt: null, leaseToken: null, nextAttemptAt: now }
    });
    const referencedPath = "data/recordings/123e4567-e89b-12d3-a456-426614174000.webm";
    await prisma.interview.create({
      data: {
        candidateName: "Synthetic Candidate",
        role: "QA Engineer",
        resumeText: "Synthetic resume",
        jobDescription: "Synthetic job description",
        recordingPath: referencedPath
      }
    });
    await enqueueRecordingCleanupTask(prisma, {
      storedPath: referencedPath,
      reason: "reference_guard_test",
      now
    });

    const deletedPaths = [];
    const processed = await processRecordingCleanupBatch({
      db: prisma,
      deleteRecording: async storedPath => { deletedPaths.push(storedPath); },
      now
    });
    assert.equal(processed.inspected, 2);
    assert.equal(processed.completed, 2);
    assert.deepEqual(deletedPaths, [storedPath]);
    assert.equal((await prisma.recordingCleanupTask.findUnique({ where: { storedPath } })).status, "completed");
    assert.equal((await prisma.recordingCleanupTask.findUnique({ where: { storedPath: referencedPath } })).status, "completed");

    // Run two real worker batches at once against the same due task. The
    // conditional updateMany lease must allow only one worker to delete it.
    const concurrentPath = "s3://recordings/123e4567-e89b-12d3-a456-426614174001.webm";
    await enqueueRecordingCleanupTask(prisma, {
      storedPath: concurrentPath,
      reason: "concurrent_worker_test",
      now
    });
    const concurrentDeletes = [];
    const deleteOnce = async path => {
      concurrentDeletes.push(path);
      await new Promise(resolve => setTimeout(resolve, 20));
    };
    const concurrentResults = await Promise.all([
      processRecordingCleanupBatch({ db: prisma, deleteRecording: deleteOnce, now }),
      processRecordingCleanupBatch({ db: prisma, deleteRecording: deleteOnce, now })
    ]);
    assert.deepEqual(concurrentDeletes, [concurrentPath]);
    assert.equal(concurrentResults.reduce((sum, result) => sum + result.completed, 0), 1);
    assert.equal((await prisma.recordingCleanupTask.findUnique({ where: { storedPath: concurrentPath } })).status, "completed");
  } finally {
    if (prisma) await prisma.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
  }
});
