import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createDeletionVerificationToken, hashDeletionVerificationToken } from "../lib/deletion-verification-policy.mjs";

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

    // Exercise candidate verification followed by separate employer approval.
    const lifecycleInterview = await prisma.interview.create({
      data: {
        candidateName: "Verification Lifecycle Candidate",
        role: "Full Stack Engineer",
        resumeText: "Lifecycle fixture resume",
        jobDescription: "Lifecycle fixture job",
        candidateEmail: "candidate@example.test"
      }
    });
    const lifecycleToken = createDeletionVerificationToken();
    const lifecycleRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: lifecycleInterview.id,
        candidateNameSnapshot: lifecycleInterview.candidateName,
        candidateEmailSnapshot: lifecycleInterview.candidateEmail,
        roleSnapshot: lifecycleInterview.role,
        reason: "Lifecycle integration test",
        requestedBy: "candidate",
        status: "pending_candidate_verification",
        verificationTokenHash: hashDeletionVerificationToken(lifecycleToken),
        verificationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        verificationSentAt: new Date()
      }
    });

    const invalidAttempt = await prisma.privacyDeletionRequest.updateMany({
      where: {
        id: lifecycleRequest.id,
        status: "pending_candidate_verification",
        verificationAttempts: { lt: 5 }
      },
      data: { verificationAttempts: { increment: 1 } }
    });
    assert.equal(invalidAttempt.count, 1);

    const candidateVerified = await prisma.$transaction(async tx => {
      const changed = await tx.privacyDeletionRequest.updateMany({
        where: {
          id: lifecycleRequest.id,
          status: "pending_candidate_verification",
          verificationTokenHash: hashDeletionVerificationToken(lifecycleToken),
          verificationExpiresAt: { gt: new Date() },
          verificationAttempts: { lt: 5 }
        },
        data: {
          status: "verified_pending_approval",
          verifiedAt: new Date(),
          verificationTokenHash: null,
          verificationExpiresAt: null
        }
      });
      if (changed.count !== 1) return false;
      await tx.privacyDeletionEvent.create({
        data: {
          requestId: lifecycleRequest.id,
          action: "candidate_verified",
          actor: "candidate",
          details: "Lifecycle integration test"
        }
      });
      return true;
    });
    assert.equal(candidateVerified, true);

    // The one-time token cannot verify the same request a second time.
    const replayedVerification = await prisma.privacyDeletionRequest.updateMany({
      where: {
        id: lifecycleRequest.id,
        status: "pending_candidate_verification",
        verificationTokenHash: hashDeletionVerificationToken(lifecycleToken)
      },
      data: { status: "verified_pending_approval" }
    });
    assert.equal(replayedVerification.count, 0);

    // Employer approval is a separate transition and requires verifiedAt.
    const prematureApproval = await prisma.privacyDeletionRequest.updateMany({
      where: {
        id: lifecycleRequest.id,
        status: "pending_candidate_verification",
        verifiedAt: { not: null }
      },
      data: { status: "approved_for_deletion" }
    });
    assert.equal(prematureApproval.count, 0);

    const employerApproval = await prisma.$transaction(async tx => {
      const changed = await tx.privacyDeletionRequest.updateMany({
        where: {
          id: lifecycleRequest.id,
          status: "verified_pending_approval",
          verifiedAt: { not: null }
        },
        data: { status: "approved_for_deletion" }
      });
      if (changed.count !== 1) return false;
      await tx.privacyDeletionEvent.create({
        data: {
          requestId: lifecycleRequest.id,
          action: "employer_approved",
          actor: "employer",
          details: "Lifecycle integration test; execution remains separate."
        }
      });
      return true;
    });
    assert.equal(employerApproval, true);
    const lifecycleReceipt = await prisma.privacyDeletionRequest.findUnique({
      where: { id: lifecycleRequest.id },
      include: { events: true }
    });
    assert.equal(lifecycleReceipt.status, "approved_for_deletion");
    assert.equal(lifecycleReceipt.events.length, 2);
    assert.equal(
      await prisma.interview.findUnique({ where: { id: lifecycleInterview.id } }) !== null,
      true
    );

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

    // A reclaimed lease must prevent the previous worker from deleting candidate data.
    const protectedInterview = await prisma.interview.create({
      data: {
        candidateName: "Stale Worker Test Candidate",
        role: "QA Engineer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job description"
      }
    });
    const protectedRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: protectedInterview.id,
        candidateNameSnapshot: protectedInterview.candidateName,
        roleSnapshot: protectedInterview.role,
        reason: "Stale worker integration test",
        requestedBy: "candidate",
        status: "deletion_in_progress",
        verifiedAt: new Date(),
        executionStartedAt: new Date(),
        executionLeaseToken: "new-worker-token"
      }
    });

    const staleWorkerResult = await prisma.$transaction(async tx => {
      const ownership = await tx.privacyDeletionRequest.updateMany({
        where: {
          id: protectedRequest.id,
          status: "deletion_in_progress",
          executionLeaseToken: "old-worker-token"
        },
        data: { executionStartedAt: new Date() }
      });
      if (ownership.count !== 1) return "lease-lost";

      await tx.interview.delete({ where: { id: protectedInterview.id } });
      return "deleted";
    });

    assert.equal(staleWorkerResult, "lease-lost");
    assert.notEqual(
      await prisma.interview.findUnique({ where: { id: protectedInterview.id } }),
      null
    );
    const protectedReceipt = await prisma.privacyDeletionRequest.findUnique({
      where: { id: protectedRequest.id }
    });
    assert.equal(protectedReceipt.status, "deletion_in_progress");

    assert.equal(protectedReceipt.executionLeaseToken, "new-worker-token");

    // Two workers racing for the same approved request must not both acquire it.
    const raceInterview = await prisma.interview.create({
      data: {
        candidateName: "Concurrent Claim Test Candidate",
        role: "Backend Engineer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job description"
      }
    });
    const raceRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: raceInterview.id,
        candidateNameSnapshot: raceInterview.candidateName,
        roleSnapshot: raceInterview.role,
        reason: "Concurrent claim integration test",
        requestedBy: "candidate",
        status: "approved_for_deletion",
        verifiedAt: new Date()
      }
    });

    const raceClaims = await Promise.all([
      prisma.privacyDeletionRequest.updateMany({
        where: { id: raceRequest.id, status: "approved_for_deletion" },
        data: {
          status: "deletion_in_progress",
          executionStartedAt: new Date(),
          executionLeaseToken: "racing-worker-one"
        }
      }),
      prisma.privacyDeletionRequest.updateMany({
        where: { id: raceRequest.id, status: "approved_for_deletion" },
        data: {
          status: "deletion_in_progress",
          executionStartedAt: new Date(),
          executionLeaseToken: "racing-worker-two"
        }
      })
    ]);
    assert.deepEqual(raceClaims.map(result => result.count).sort(), [0, 1]);
    const raceWinner = await prisma.privacyDeletionRequest.findUnique({
      where: { id: raceRequest.id }
    });
    assert.equal(raceWinner.status, "deletion_in_progress");
    assert.ok(["racing-worker-one", "racing-worker-two"].includes(raceWinner.executionLeaseToken));

    // Even an accidentally approved status must not bypass candidate verification.
    const unverifiedInterview = await prisma.interview.create({
      data: {
        candidateName: "Unverified Claim Test Candidate",
        role: "Developer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job description"
      }
    });
    const unverifiedRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: unverifiedInterview.id,
        candidateNameSnapshot: unverifiedInterview.candidateName,
        roleSnapshot: unverifiedInterview.role,
        reason: "Unverified claim integration test",
        requestedBy: "employer",
        status: "approved_for_deletion",
        verifiedAt: null
      }
    });
    const unverifiedClaim = await prisma.privacyDeletionRequest.updateMany({
      where: {
        id: unverifiedRequest.id,
        verifiedAt: { not: null },
        status: "approved_for_deletion"
      },
      data: {
        status: "deletion_in_progress",
        executionStartedAt: new Date(),
        executionLeaseToken: "must-not-claim"
      }
    });
    assert.equal(unverifiedClaim.count, 0);
    assert.equal(
      (await prisma.privacyDeletionRequest.findUnique({ where: { id: unverifiedRequest.id } })).status,
      "approved_for_deletion"
    );

    // A storage failure should leave interview data intact and permit a safe retry.
    const retryInterview = await prisma.interview.create({
      data: {
        candidateName: "Retry Test Candidate",
        role: "Data Analyst",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job description"
      }
    });
    const retryRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: retryInterview.id,
        candidateNameSnapshot: retryInterview.candidateName,
        roleSnapshot: retryInterview.role,
        reason: "Retry integration test",
        requestedBy: "candidate",
        status: "deletion_in_progress",
        verifiedAt: new Date(),
        executionStartedAt: new Date(),
        executionLeaseToken: "failed-worker-token"
      }
    });

    await prisma.$transaction(async tx => {
      const failed = await tx.privacyDeletionRequest.updateMany({
        where: {
          id: retryRequest.id,
          status: "deletion_in_progress",
          executionLeaseToken: "failed-worker-token"
        },
        data: {
          status: "deletion_failed",
          lastErrorCode: "DELETION_EXECUTION_FAILED",
          executionStartedAt: null,
          executionLeaseToken: null
        }
      });
      assert.equal(failed.count, 1);
      await tx.privacyDeletionEvent.create({
        data: {
          requestId: retryRequest.id,
          action: "deletion_failed",
          actor: "system",
          details: "Integration test simulated a storage failure."
        }
      });
    });

    assert.notEqual(
      await prisma.interview.findUnique({ where: { id: retryInterview.id } }),
      null
    );
    const failedReceipt = await prisma.privacyDeletionRequest.findUnique({
      where: { id: retryRequest.id }
    });
    assert.equal(failedReceipt.status, "deletion_failed");
    assert.equal(failedReceipt.executionLeaseToken, null);
    assert.equal(failedReceipt.lastErrorCode, "DELETION_EXECUTION_FAILED");

    const retryClaim = await prisma.privacyDeletionRequest.updateMany({
      where: { id: retryRequest.id, status: "deletion_failed" },
      data: {
        status: "deletion_in_progress",
        executionStartedAt: new Date(),
        executionLeaseToken: "retry-worker-token",
        lastErrorCode: null,
        deletionAttempts: { increment: 1 }
      }
    });
    assert.equal(retryClaim.count, 1);
    const retriedReceipt = await prisma.privacyDeletionRequest.findUnique({
      where: { id: retryRequest.id }
    });
    assert.equal(retriedReceipt.status, "deletion_in_progress");
    assert.equal(retriedReceipt.executionLeaseToken, "retry-worker-token");
    assert.equal(retriedReceipt.lastErrorCode, null);
  } finally {
    if (prisma) await prisma.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
  }
});
