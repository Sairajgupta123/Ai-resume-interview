# Pre-release end-to-end smoke test

This checklist is for a staging deployment using the intended browser, xAI account, HTTPS origin, private S3-compatible bucket and TURN service. Unit tests and a production build do not replace these checks.

## Test environment

- [ ] Use synthetic candidate data only; never use real resumes or recordings for the first run.
- [ ] Confirm the deployment uses HTTPS and the canonical `NEXT_PUBLIC_APP_URL`.
- [ ] Confirm production secrets are configured in the deployment secret manager, not committed to Git.
- [ ] Confirm the database is on a persistent supported deployment target. This repository currently uses SQLite; do not use an ephemeral serverless filesystem or assume PostgreSQL compatibility.
- [ ] Confirm the recording bucket is private and test credentials are scoped to the required bucket operations.
- [ ] Confirm the xAI account has access to the configured chat and Realtime models.
- [ ] Confirm TURN credentials are configured if cross-network candidate/employer video is required.

## Employer and invitation

- [ ] Employer can log in with the configured credentials.
- [ ] Repeated invalid logins are rate-limited and return a retry delay.
- [ ] Employer can create an invitation with valid candidate name, email, role, resume, job description and interview mode.
- [ ] Invitation link expires at the configured 72-hour boundary.
- [ ] Opening the link exchanges the one-time URL token for a scoped HttpOnly cookie.
- [ ] Replaying the original URL token after exchange is rejected.
- [ ] Refreshing the candidate page restores the same active interview without exposing the bearer token in API requests.
- [ ] An expired or unknown invitation receives a generic authorization failure.

## Recorded interview

- [ ] Candidate sees and accepts the consent notice before camera/microphone capture begins.
- [ ] Candidate can deny either permission and receives a recoverable explanation.
- [ ] Candidate can complete a recorded interview and submit a report.
- [ ] Refresh during recording restores recoverable chunks from the same browser profile.
- [ ] Simulate a browser/tab interruption after several one-second chunks; recovery identifies the recording as partial and does not upload it as complete.
- [ ] Verify missing chunk indexes and mixed MIME types are rejected rather than silently concatenated.
- [ ] Verify a new recording starting at chunk zero removes stale trailing chunks from an earlier attempt.
- [ ] Simulate IndexedDB quota/write failure; the UI warns that local backup failed and does not claim the recording is recoverable.
- [ ] Abort an upload at the client timeout; local complete chunks remain available for a retry.
- [ ] A failed upload can be retried without creating a second recording.
- [ ] A report cannot be finalized while recording upload or recovery is incomplete.
- [ ] Complete a report after a failed upload, then verify one late recovery is accepted only when no recording was previously committed; subsequent replacement attempts are rejected.
- [ ] The recording is stored privately in the configured object bucket, not in a public URL or SQLite blob.
- [ ] Employer can play, seek, pause and resume the recording; unauthorized candidate/session IDs cannot retrieve it.

## Live AI interview

- [ ] Candidate can start a consented live interview and obtain an ephemeral Realtime credential.
- [ ] Browser network inspection confirms the permanent `XAI_API_KEY` is never sent to the client.
- [ ] Microphone audio reaches xAI Realtime and interviewer audio plays through the browser.
- [ ] Candidate interruption, mute/unmute, reconnect and network recovery behave correctly.
- [ ] Drop the network while a transcript write is pending; reconnect retries the same message IDs before opening a new voice session.
- [ ] Force a transcript write to fail permanently; voice input becomes unavailable, typing remains usable, and report generation is blocked until queued transcript entries are saved.
- [ ] Finalized candidate and interviewer transcript turns are saved once, in chronological order.
- [ ] Retrying a transcript message with the same client message ID is idempotent; changing its content is rejected.
- [ ] Close an old Realtime socket after reconnect; callbacks from the replaced socket must not append duplicate transcript entries.
- [ ] Candidate cannot append transcript messages after completion, expiry or the 15-minute limit.
- [ ] Resume, job-description or transcript text containing prompt-injection instructions is treated as untrusted context.

## Candidate-to-employer WebRTC room

- [ ] Candidate ICE credentials are not issued before consent and interview start.
- [ ] Candidate and employer can connect from separate networks using configured TURN credentials.
- [ ] Camera/microphone tracks can be muted and restored.
- [ ] Reconnection after refresh uses the scoped candidate cookie.
- [ ] Signalling rejects malformed, oversized or wrong-participant messages.

## Employer dashboard pagination and analytics

- [ ] Create more than 100 synthetic interviews and confirm the first page contains no more than 100 rows.
- [ ] Load subsequent pages and confirm there are no duplicate or missing interview IDs, including records with identical creation timestamps.
- [ ] Confirm newest-first ordering remains stable across page boundaries.
- [ ] Confirm an invalid or oversized cursor is rejected with a client error and does not expose interview data.
- [ ] Delete the last-row cursor record between page requests and confirm the next-page request returns a recoverable client error; refreshing the dashboard restarts pagination cleanly.
- [ ] Confirm candidate search and CSV export clearly apply to currently loaded pages only.
- [ ] Confirm analytics totals and six-week trends remain consistent with the underlying synthetic dataset.

## Report, employer review and exports

- [ ] Report generation uses the saved server-side transcript, not a client-submitted replacement transcript.
- [ ] Report evidence quotes match candidate answers verbatim.
- [ ] Missing evidence is not represented as a positive skill rating.
- [ ] Report generation can recover the same committed report after a lost response or refresh.
- [ ] Employer can review transcript, report and private recording.
- [ ] Employer can record shortlist, review or reject with notes; decision history is retained.
- [ ] Candidate comparison displays evidence and missing-evidence states without automatically selecting a winner.
- [ ] CSV exports open correctly and formula-like candidate text is not executed by spreadsheet software.

## Privacy deletion and recovery

- [ ] Candidate can submit a deletion request and receives a one-time verification link.
- [ ] Verification link expires and attempt limits are enforced.
- [ ] Employer approval is a separate action after candidate verification.
- [ ] Approved deletion removes the private recording before database deletion is finalized.
- [ ] Interview, transcript, report, decision history and signalling rows are removed.
- [ ] A failed object-storage deletion leaves database candidate data intact and the request retryable.
- [ ] A stale deletion worker cannot finalize after another worker takes over its lease.
- [ ] The retained deletion receipt contains no candidate name, email, role, resume, transcript or free-form reason.
- [ ] Browser IndexedDB cleanup is tested on the same browser/device; do not claim it can remotely clear another device.
- [ ] Provider-side retention for xAI and email delivery is reviewed separately; app deletion cannot guarantee provider-side erasure.

## Sign-off

Record deployment version, browser/OS, database and object-storage provider, test date, failed cases and evidence (with synthetic data only). Do not mark the release production-ready while any critical path above is untested or failing.
