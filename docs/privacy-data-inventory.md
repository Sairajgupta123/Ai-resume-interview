# Candidate data inventory and deletion scope

This inventory describes the persistence locations currently present in the application. It is an engineering checklist, not a legal compliance certification. Re-check it whenever a feature adds a database model, file upload, browser cache, provider integration, export, or background job.

## Current application data map

| Data | Current location | Deletion behavior | Boundary / verification |
|---|---|---|---|
| Candidate name, email, role, resume text and job description | `Interview` row in SQLite/Prisma | Interview row is deleted by approved deletion execution | Verify new candidate fields are added to this row or another inventoried store |
| Transcript messages | `InterviewMessage` rows | Related rows are deleted with the interview (explicit cleanup / cascade) | Database integration test checks messages are gone |
| AI report and score | `Interview.reportJson`, score and recommendation columns | Deleted with the interview row | Do not create a separate report store without adding cleanup |
| Employer decision and notes | `Interview.employerDecision`, `employerNotes`, decision timestamp; history in `EmployerDecisionHistory` | Interview fields disappear with row; history rows are deleted | Database integration test checks decision history |
| Live WebRTC signaling | `InterviewSignal` rows | Related rows are deleted with the interview | Database integration test checks signals |
| Interview recording | Local `data/recordings` in development or private S3-compatible object storage in production; path stored on `Interview` | Storage object is deleted before the database transaction completes | Storage adapter tests cover local and mocked S3 deletion, including missing objects and failures |
| In-progress recording chunks | Candidate browser IndexedDB database `mzobs-interview-recordings` | Cleared after successful upload; deletion verification attempts cleanup on the browser/device opening the link | Cannot remotely erase another device's browser storage; browser cleanup can fail or data may already be unavailable |
| Deletion request receipt and event history | `PrivacyDeletionRequest`, `PrivacyDeletionEvent` | Candidate-identifying snapshots are anonymized; event action, actor and timestamp remain while free-form event details are replaced with generic text | This is intentionally retained as a minimal deletion accountability record; completion tests verify candidate email text is not retained in event details |
| Login rate-limit counters | `LoginAttempt` | Not candidate interview content; independently expires/resets through login policy | Do not store candidate data in rate-limit keys |
| CSV exports | Generated on demand by authenticated export endpoints | No server-side export archive is currently implemented | If export persistence is added, inventory and delete it |
| AI processing | xAI Grok API receives interview/resume/job context for generation and evaluation | The app cannot delete provider-side logs or retained copies through the current integration | Review provider retention and contractual settings separately |
| Verification email | Resend sends the one-time verification link | App stores only a hashed verification token; provider-side delivery logs are outside app deletion control | Review provider retention and email security separately |

## Required checklist for every new feature

Before merging a feature that handles candidate-related information, answer all of the following:

- [ ] What exact candidate fields or media does it collect?
- [ ] Is the data persisted? Identify the exact database model/table and fields, object-storage key, filesystem path, browser storage key, or external provider.
- [ ] Is the data copied, cached, indexed, exported, logged, or sent to another service?
- [ ] Does approved deletion remove every application-controlled copy?
- [ ] If a copy is intentionally retained (for example, a minimal deletion receipt), are the retained fields minimized and documented?
- [ ] Are external-provider retention limits and deletion capabilities documented separately?
- [ ] Are failure and retry behavior safe? A failed storage deletion must not be reported as completed.
- [ ] Is there a test proving the new store is cleaned up, or proving and documenting why it is intentionally retained?
- [ ] Has this inventory and the privacy notice been updated?

## Deletion completion invariants

1. Candidate verification and separate employer approval are both required before execution.
2. The recording object must be deleted or confirmed absent before the interview database transaction is finalized.
3. The execution lease must still belong to the worker finalizing deletion.
4. Interview, transcript, report, decision history and signaling data must no longer be queryable after successful completion.
5. Only the anonymized deletion receipt and generic deletion audit history remain in the application database; free-form event details are normalized at completion to prevent accidental retention of candidate content.
6. Any failure must leave the request retryable and must not claim successful deletion.
7. Browser-local data on other devices and provider-side copies are outside the app's direct deletion capability and must never be represented as remotely erased.

## Scope review trigger

Revisit this document whenever `prisma/schema.prisma` gains a model or candidate-related field, any API adds file/browser persistence, any provider integration changes, or exports become stored artifacts. The deletion integration tests should be expanded in the same change.


## Recording access audit events

The employer recording-access history is a separate operational audit record. It is not part of the hiring-decision history and must not be interpreted as evidence that a candidate's recording was watched.

| Data | Current location | Deletion behavior | Boundary / verification |
|---|---|---|---|
| Authorized recording request metadata | `RecordingAccessEvent`: interview ID, HTTP method (`GET` or `HEAD`), outcome and timestamp | Deleted automatically when the related `Interview` row is deleted (`onDelete: Cascade`) | Integration test seeds an event and verifies it is removed with interview deletion |

An event with outcome `response_prepared` means the server prepared an authorized response after validating the recording metadata. It does **not** prove that playback started, that the video was watched, or that it was watched in full. Browser players can make multiple range requests during one viewing, so event counts are not unique viewer counts or viewing sessions.

The employer audit endpoint requires employer authentication and returns only the minimal event fields needed by the dashboard. Do not add IP addresses, browser fingerprints, authorization tokens, byte-range offsets, recording filenames, or recording contents to this model or UI without a separate privacy and security review.

## Dependency security checks

The CI workflow reports `npm audit` findings with package names, severity, affected ranges, advisory references and fix availability. This is a report-only check: it does not automatically upgrade dependencies or fail the build. Resolve each advisory deliberately, then rerun unit tests, type checks and the production build. Keep dependency versions and the generated lockfile under review so builds remain reproducible.
