-- Initial PostgreSQL schema for MZOBS AI Interview.
-- IDs are supplied by Prisma's cuid() client-side default, matching the SQLite schema.
CREATE TABLE "Interview" (
"id" TEXT NOT NULL, "candidateName" TEXT NOT NULL, "role" TEXT NOT NULL,
"mode" TEXT NOT NULL DEFAULT 'live', "status" TEXT NOT NULL DEFAULT 'completed',
"resumeText" TEXT NOT NULL, "jobDescription" TEXT NOT NULL, "reportJson" TEXT,
"overallScore" INTEGER, "recommendation" TEXT, "recordingPath" TEXT, "candidateEmail" TEXT,
"invitationTokenHash" TEXT, "inviteExpiresAt" TIMESTAMP(3), "inviteUsedAt" TIMESTAMP(3),
"startedAt" TIMESTAMP(3), "startLockAt" TIMESTAMP(3), "answerLockAt" TIMESTAMP(3),
"reportLockAt" TIMESTAMP(3), "consentAcceptedAt" TIMESTAMP(3), "consentVersion" TEXT,
"employerDecision" TEXT, "employerNotes" TEXT, "decisionAt" TIMESTAMP(3),
"durationSeconds" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LoginAttempt" (
"id" TEXT NOT NULL, "key" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
"windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "blockedUntil" TIMESTAMP(3),
"updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InterviewMessage" (
"id" TEXT NOT NULL, "interviewId" TEXT NOT NULL, "role" TEXT NOT NULL, "content" TEXT NOT NULL,
"clientMessageId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "InterviewMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "EmployerDecisionHistory" (
"id" TEXT NOT NULL, "interviewId" TEXT NOT NULL, "decision" TEXT NOT NULL, "notes" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "EmployerDecisionHistory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InterviewSignal" (
"id" TEXT NOT NULL, "interviewId" TEXT NOT NULL, "sender" TEXT NOT NULL, "kind" TEXT NOT NULL,
"payload" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "InterviewSignal_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PrivacyDeletionRequest" (
"id" TEXT NOT NULL, "interviewId" TEXT NOT NULL, "candidateNameSnapshot" TEXT NOT NULL,
"candidateEmailSnapshot" TEXT, "roleSnapshot" TEXT NOT NULL, "reason" TEXT NOT NULL,
"status" TEXT NOT NULL DEFAULT 'pending_candidate_verification', "requestedBy" TEXT NOT NULL,
"verificationTokenHash" TEXT, "verificationExpiresAt" TIMESTAMP(3), "verificationSentAt" TIMESTAMP(3),
"verifiedAt" TIMESTAMP(3), "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
"deletionAttempts" INTEGER NOT NULL DEFAULT 0, "executionStartedAt" TIMESTAMP(3),
"executionLeaseToken" TEXT, "completedAt" TIMESTAMP(3), "lastErrorCode" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "PrivacyDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PrivacyDeletionEvent" (
"id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "action" TEXT NOT NULL, "actor" TEXT NOT NULL,
"details" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "PrivacyDeletionEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Interview_invitationTokenHash_key" ON "Interview"("invitationTokenHash");
CREATE INDEX "Interview_createdAt_idx" ON "Interview"("createdAt");
CREATE INDEX "Interview_candidateName_idx" ON "Interview"("candidateName");
CREATE UNIQUE INDEX "LoginAttempt_key_key" ON "LoginAttempt"("key");
CREATE INDEX "LoginAttempt_blockedUntil_idx" ON "LoginAttempt"("blockedUntil");
CREATE INDEX "LoginAttempt_windowStartedAt_idx" ON "LoginAttempt"("windowStartedAt");
CREATE UNIQUE INDEX "InterviewMessage_clientMessageId_key" ON "InterviewMessage"("clientMessageId");
CREATE INDEX "InterviewMessage_interviewId_createdAt_idx" ON "InterviewMessage"("interviewId", "createdAt");
CREATE INDEX "EmployerDecisionHistory_interviewId_createdAt_idx" ON "EmployerDecisionHistory"("interviewId", "createdAt");
CREATE INDEX "InterviewSignal_interviewId_createdAt_idx" ON "InterviewSignal"("interviewId", "createdAt");
CREATE UNIQUE INDEX "PrivacyDeletionRequest_verificationTokenHash_key" ON "PrivacyDeletionRequest"("verificationTokenHash");
CREATE UNIQUE INDEX "PrivacyDeletionRequest_executionLeaseToken_key" ON "PrivacyDeletionRequest"("executionLeaseToken");
CREATE UNIQUE INDEX "PrivacyDeletionRequest_interviewId_key" ON "PrivacyDeletionRequest"("interviewId");
CREATE INDEX "PrivacyDeletionRequest_createdAt_idx" ON "PrivacyDeletionRequest"("createdAt");
CREATE INDEX "PrivacyDeletionEvent_requestId_createdAt_idx" ON "PrivacyDeletionEvent"("requestId", "createdAt");
ALTER TABLE "InterviewMessage" ADD CONSTRAINT "InterviewMessage_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployerDecisionHistory" ADD CONSTRAINT "EmployerDecisionHistory_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewSignal" ADD CONSTRAINT "InterviewSignal_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivacyDeletionEvent" ADD CONSTRAINT "PrivacyDeletionEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PrivacyDeletionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
