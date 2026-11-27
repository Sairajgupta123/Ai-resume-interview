import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test } from "node:test";
import { createDeletionVerificationToken, hashDeletionVerificationToken } from "../lib/deletion-verification-policy.mjs";
import { approveVerifiedDeletionRequest } from "../lib/deletion-approval-service.mjs";
import { verifyDeletionRequest, reserveDeletionVerificationEmail, recordDeletionVerificationEmailSent, recordDeletionVerificationEmailFailure } from "../lib/deletion-verification-service.mjs";
import { DELETION_VERIFICATION_RESEND_COOLDOWN_MS } from "../lib/deletion-verification-policy.mjs";
import { finalizeDeletionExecution, markDeletionExecutionFailed } from "../lib/deletion-execution-service.mjs";

test("privacy deletion transaction removes interview data and retains an anonymized receipt", async () => {
  const baseDatabaseUrl = process.env.DATABASE_URL || "";
  assert.ok(/^postgres(?:ql)?:\/\//i.test(baseDatabaseUrl), "PostgreSQL DATABASE_URL is required for database integration tests");
  const schemaName = `deletion_test_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(baseDatabaseUrl);
  isolatedUrl.searchParams.set("schema", schemaName);
  const databaseUrl = isolatedUrl.toString();
  const projectRoot = resolve(".");
  let prisma;
  let admin;

  try {
    const { PrismaClient } = await import("@prisma/client");
    admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
    await admin.$connect();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

    execFileSync(
      process.execPath,
      [resolve(projectRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", "prisma/schema.prisma"],
      { cwd: projectRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" }
    );

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

    const candidateVerified = await verifyDeletionRequest(
      prisma,
      lifecycleRequest.id,
      hashDeletionVerificationToken(lifecycleToken)
    );
    assert.equal(candidateVerified, true);
    assert.equal(
      await verifyDeletionRequest(prisma, lifecycleRequest.id, hashDeletionVerificationToken(lifecycleToken)),
      false
    );

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

    // Expired links and requests at the attempt limit must not verify.
    const expiredInterview = await prisma.interview.create({
      data: {
        candidateName: "Expired Link Candidate",
        role: "Engineer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job"
      }
    });
    const expiredToken = createDeletionVerificationToken();
    const expiredRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: expiredInterview.id,
        candidateNameSnapshot: expiredInterview.candidateName,
        roleSnapshot: expiredInterview.role,
        reason: "Expired token test",
        requestedBy: "candidate",
        status: "pending_candidate_verification",
        verificationTokenHash: hashDeletionVerificationToken(expiredToken),
        verificationExpiresAt: new Date(Date.now() - 1_000)
      }
    });
    const expiredClaim = await prisma.privacyDeletionRequest.updateMany({
      where: {
        id: expiredRequest.id,
        status: "pending_candidate_verification",
        verificationTokenHash: hashDeletionVerificationToken(expiredToken),
        verificationExpiresAt: { gt: new Date() },
        verificationAttempts: { lt: 5 }
      },
      data: { status: "verified_pending_approval", verifiedAt: new Date() }
    });
    assert.equal(expiredClaim.count, 0);

    const lockedInterview = await prisma.interview.create({
      data: {
        candidateName: "Attempt Limit Candidate",
        role: "Engineer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job"
      }
    });
    const lockedToken = createDeletionVerificationToken();
    const lockedRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: lockedInterview.id,
        candidateNameSnapshot: lockedInterview.candidateName,
        roleSnapshot: lockedInterview.role,
        reason: "Attempt limit test",
        requestedBy: "candidate",
        status: "pending_candidate_verification",
        verificationTokenHash: hashDeletionVerificationToken(lockedToken),
        verificationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        verificationAttempts: 5
      }
    });
    const lockedVerification = await prisma.privacyDeletionRequest.updateMany({
      where: {
        id: lockedRequest.id,
        status: "pending_candidate_verification",
        verificationTokenHash: hashDeletionVerificationToken(lockedToken),
        verificationExpiresAt: { gt: new Date() },
        verificationAttempts: { lt: 5 }
      },
      data: { status: "verified_pending_approval", verifiedAt: new Date() }
    });
    assert.equal(lockedVerification.count, 0);

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

    const employerApproval = await approveVerifiedDeletionRequest(prisma, lifecycleRequest.id);
    assert.equal(employerApproval, true);
    assert.equal(await approveVerifiedDeletionRequest(prisma, lifecycleRequest.id), false);
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
        candidateEmailSnapshot: "candidate@example.test",
        roleSnapshot: interview.role,
        reason: "Private deletion reason with candidate@example.test",
        requestedBy: "candidate",
        status: "deletion_in_progress",
        verifiedAt: new Date(),
        executionStartedAt: new Date(),
        executionLeaseToken: "current-worker-token",
        events: {
          create: [{
            action: "verification_email_sent",
            actor: "system",
            details: "Sent private verification link to candidate@example.test"
          }]
        }
      }
    });

    await finalizeDeletionExecution(prisma, {
      requestId: request.id,
      interviewId: interview.id,
      leaseToken: "current-worker-token"
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
    assert.equal(receipt.candidateEmailSnapshot, null);
    assert.equal(receipt.roleSnapshot, "[deleted]");
    assert.equal(receipt.reason, "Candidate data deletion completed.");
    assert.equal(receipt.verificationTokenHash, null);
    assert.equal(receipt.verificationExpiresAt, null);
    assert.equal(receipt.lastErrorCode, null);
    assert.equal(receipt.executionLeaseToken, null);
    assert.equal(receipt.events.length, 2);
    assert.equal(receipt.events.some(event => event.action === "deletion_completed"), true);
    assert.equal(receipt.events.every(event => event.details === "Workflow metadata retained for deletion accountability; candidate content is not retained."), true);
    assert.equal(receipt.events.some(event => event.details?.includes("candidate@example.test")), false);

    // Finalization must bind the lease to the interview recorded on the request.
    const boundInterview = await prisma.interview.create({
      data: {
        candidateName: "Lease Binding Candidate",
        role: "Engineer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job"
      }
    });
    const unrelatedInterview = await prisma.interview.create({
      data: {
        candidateName: "Unrelated Candidate",
        role: "Engineer",
        resumeText: "Must remain",
        jobDescription: "Dummy job"
      }
    });
    const boundRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: boundInterview.id,
        candidateNameSnapshot: boundInterview.candidateName,
        roleSnapshot: boundInterview.role,
        reason: "Lease binding integration test",
        requestedBy: "candidate",
        status: "deletion_in_progress",
        verifiedAt: new Date(),
        executionStartedAt: new Date(),
        executionLeaseToken: "bound-worker-token"
      }
    });
    await assert.rejects(
      () => finalizeDeletionExecution(prisma, {
        requestId: boundRequest.id,
        interviewId: unrelatedInterview.id,
        leaseToken: "bound-worker-token"
      }),
      { message: "DELETION_LEASE_LOST" }
    );
    assert.notEqual(await prisma.interview.findUnique({ where: { id: boundInterview.id } }), null);
    assert.notEqual(await prisma.interview.findUnique({ where: { id: unrelatedInterview.id } }), null);
    const boundReceipt = await prisma.privacyDeletionRequest.findUnique({ where: { id: boundRequest.id } });
    assert.equal(boundReceipt.status, "deletion_in_progress");
    assert.equal(boundReceipt.executionLeaseToken, "bound-worker-token");

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

    await assert.rejects(
      () => finalizeDeletionExecution(prisma, {
        requestId: protectedRequest.id,
        interviewId: protectedInterview.id,
        leaseToken: "old-worker-token"
      }),
      { message: "DELETION_LEASE_LOST" }
    );
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

    // Concurrent email-resend requests must have exactly one reservation winner.
    const resendInterview = await prisma.interview.create({
      data: {
        candidateName: "Concurrent Resend Candidate",
        role: "Engineer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job",
        candidateEmail: "resend@example.test"
      }
    });
    const resendRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: resendInterview.id,
        candidateNameSnapshot: resendInterview.candidateName,
        candidateEmailSnapshot: resendInterview.candidateEmail,
        roleSnapshot: resendInterview.role,
        reason: "Concurrent resend test",
        requestedBy: "employer",
        status: "pending_candidate_verification"
      }
    });
    const resendNow = new Date();
    const resendReservations = await Promise.all([
      reserveDeletionVerificationEmail(prisma, {
        requestId: resendRequest.id,
        tokenHash: hashDeletionVerificationToken(createDeletionVerificationToken()),
        now: resendNow,
        expiresAt: new Date(resendNow.getTime() + 30 * 60 * 1000),
        cooldownMs: DELETION_VERIFICATION_RESEND_COOLDOWN_MS
      }),
      reserveDeletionVerificationEmail(prisma, {
        requestId: resendRequest.id,
        tokenHash: hashDeletionVerificationToken(createDeletionVerificationToken()),
        now: resendNow,
        expiresAt: new Date(resendNow.getTime() + 30 * 60 * 1000),
        cooldownMs: DELETION_VERIFICATION_RESEND_COOLDOWN_MS
      })
    ]);
    assert.deepEqual(resendReservations.sort(), [false, true]);
    const resendWinner = await prisma.privacyDeletionRequest.findUnique({
      where: { id: resendRequest.id }
    });
    assert.equal(resendWinner.verificationSentAt.getTime(), resendNow.getTime());
    assert.ok(resendWinner.verificationTokenHash);

    const activeEmailTokenHash = resendWinner.verificationTokenHash;
    assert.equal(
      await recordDeletionVerificationEmailSent(prisma, resendRequest.id, activeEmailTokenHash),
      true
    );
    const replacementTime = new Date(resendNow.getTime() + DELETION_VERIFICATION_RESEND_COOLDOWN_MS + 1);
    const replacementTokenHash = hashDeletionVerificationToken(createDeletionVerificationToken());
    assert.equal(
      await reserveDeletionVerificationEmail(prisma, {
        requestId: resendRequest.id,
        tokenHash: replacementTokenHash,
        now: replacementTime,
        expiresAt: new Date(replacementTime.getTime() + 30 * 60 * 1000),
        cooldownMs: DELETION_VERIFICATION_RESEND_COOLDOWN_MS
      }),
      true
    );
    assert.equal(
      await recordDeletionVerificationEmailSent(prisma, resendRequest.id, activeEmailTokenHash),
      false
    );
    assert.equal(
      await recordDeletionVerificationEmailSent(prisma, resendRequest.id, replacementTokenHash),
      true
    );

    // Failed email delivery invalidates and audits only the token that actually failed.
    const failedEmailInterview = await prisma.interview.create({
      data: {
        candidateName: "Failed Verification Email Candidate",
        role: "Engineer",
        resumeText: "Dummy resume",
        jobDescription: "Dummy job",
        candidateEmail: "failed-email@example.test"
      }
    });
    const failedEmailTokenHash = hashDeletionVerificationToken(createDeletionVerificationToken());
    const failedEmailRequest = await prisma.privacyDeletionRequest.create({
      data: {
        interviewId: failedEmailInterview.id,
        candidateNameSnapshot: failedEmailInterview.candidateName,
        candidateEmailSnapshot: failedEmailInterview.candidateEmail,
        roleSnapshot: failedEmailInterview.role,
        reason: "Failed email audit test",
        requestedBy: "employer",
        status: "pending_candidate_verification",
        verificationTokenHash: failedEmailTokenHash,
        verificationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        verificationSentAt: new Date()
      }
    });
    assert.equal(
      await recordDeletionVerificationEmailFailure(prisma, failedEmailRequest.id, failedEmailTokenHash),
      true
    );
    const failedEmailReceipt = await prisma.privacyDeletionRequest.findUnique({
      where: { id: failedEmailRequest.id },
      include: { events: true }
    });
    assert.equal(failedEmailReceipt.verificationTokenHash, null);
    assert.equal(failedEmailReceipt.verificationExpiresAt, null);
    assert.equal(failedEmailReceipt.verificationSentAt, null);
    assert.equal(failedEmailReceipt.status, "pending_candidate_verification");
    assert.equal(failedEmailReceipt.events.length, 1);
    assert.equal(failedEmailReceipt.events[0].action, "verification_email_failed");
    assert.equal(
      await recordDeletionVerificationEmailFailure(prisma, failedEmailRequest.id, failedEmailTokenHash),
      false
    );

    // A delayed failure from an older send must not invalidate a newer verification link.
    const replacedEmailTokenHash = hashDeletionVerificationToken(createDeletionVerificationToken());
    await prisma.privacyDeletionRequest.update({
      where: { id: failedEmailRequest.id },
      data: {
        verificationTokenHash: replacedEmailTokenHash,
        verificationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        verificationSentAt: new Date()
      }
    });
    assert.equal(
      await recordDeletionVerificationEmailFailure(prisma, failedEmailRequest.id, failedEmailTokenHash),
      false
    );
    const replacedEmailReceipt = await prisma.privacyDeletionRequest.findUnique({
      where: { id: failedEmailRequest.id },
      include: { events: true }
    });
    assert.equal(replacedEmailReceipt.verificationTokenHash, replacedEmailTokenHash);
    assert.equal(replacedEmailReceipt.events.length, 1);

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

    const failureRecorded = await markDeletionExecutionFailed(prisma, {
      requestId: retryRequest.id,
      leaseToken: "failed-worker-token",
      errorCode: "DELETION_EXECUTION_FAILED"
    });
    assert.equal(failureRecorded, true);
    assert.equal(
      await markDeletionExecutionFailed(prisma, {
        requestId: retryRequest.id,
        leaseToken: "failed-worker-token",
        errorCode: "DELETION_EXECUTION_FAILED"
      }),
      false
    );

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
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.$disconnect();
    }
  }
});
