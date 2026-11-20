import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("privacy deletion transaction removes interview data and retains an anonymized receipt", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ai-interview-deletion-"));
  const databaseUrl = `file:${join(tempDir, "integration.db").replaceAll("\\", "/")}`;
  const projectRoot = resolve(".");
  let prisma;

  try {
    execFileSync(
      process.execPath,
      [resolve(projectRoot, "node_modules/prisma/build/index.js"), "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"],
      { cwd: projectRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" }
    );

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    const interview = await prisma.interview.create({
      data: {
        candidateName: "Integration Test Candidate",
        role: "Software Engineer",
        resumeText: "Dummy resume content",
        jobDescription: "Dummy job description",
        recordingPath: null,
        messages: { create: [{ role: "candidate", content: "Dummy answer" }] },
        signals: { create: [{ sender: "candidate", kind: "answer", payload: "Dummy signal" }] },
        decisionHistory: { create: [{ decision: "shortlisted", notes: "Dummy note" }] }
      }
    });

    const request = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: interview.id,
        candidateNameSnapshot: interview.candidateName,
        candidateEmailSnapshot: null,
        roleSnapshot: interview.role,
        reason: "Integration test deletion",
        requestedBy: "candidate",
        status: "deletion_in_progress",
        verifiedAt: new Date(),
        executionStartedAt: new Date(),
        executionLeaseToken: "current-worker-token"
      }
    });

    await prisma.$transaction(async tx => {
      const ownership = await tx.privacyDeletionRequest.updateMany({
        where: { id: request.id, status: "deletion_in_progress", executionLeaseToken: "current-worker-token" },
        data: { executionStartedAt: new Date() }
      });
      assert.equal(ownership.count, 1);

      await tx.interviewMessage.deleteMany({ where: { interviewId: interview.id } });
      await tx.interviewSignal.deleteMany({ where: { interviewId: interview.id } });
      await tx.employerDecisionHistory.deleteMany({ where: { interviewId: interview.id } });
      await tx.interview.delete({ where: { id: interview.id } });
      await tx.privacyDeletionEvent.create({
        data: { requestId: request.id, action: "deletion_completed", actor: "employer", details: "Integration test receipt" }
      });
      await tx.privacyDeletionRequest.update({
        where: { id: request.id },
        data: {
          interviewId: `deleted:${request.id}`,
          candidateNameSnapshot: "[deleted]",
          candidateEmailSnapshot: null,
          roleSnapshot: "[deleted]",
          reason: "Candidate data deletion completed.",
          verificationTokenHash: null,
          verificationExpiresAt: null,
          status: "deletion_completed",
          completedAt: new Date(),
          executionStartedAt: null,
          executionLeaseToken: null
        }
      });
    });

    assert.equal(await prisma.interview.findUnique({ where: { id: interview.id } }), null);
    assert.equal(await prisma.interviewMessage.count({ where: { interviewId: interview.id } }), 0);
    assert.equal(await prisma.interviewSignal.count({ where: { interviewId: interview.id } }), 0);
    assert.equal(await prisma.employerDecisionHistory.count({ where: { interviewId: interview.id } }), 0);

    const receipt = await prisma.privacyDeletionRequest.findUnique({
      where: { id: request.id },
      include: { events: true }
    });
    assert.equal(receipt.status, "deletion_completed");
    assert.equal(receipt.interviewId, `deleted:${request.id}`);
    assert.equal(receipt.candidateNameSnapshot, "[deleted]");
    assert.equal(receipt.roleSnapshot, "[deleted]");
    assert.equal(receipt.executionLeaseToken, null);
    assert.equal(receipt.events.length, 1);
    assert.equal(receipt.events[0].action, "deletion_completed");
  } finally {
    if (prisma) await prisma.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
  }
});
