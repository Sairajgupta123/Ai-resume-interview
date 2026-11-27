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

- [ ] At the production ingress, send a forged `X-Real-IP` and `X-Forwarded-For` value; confirm the proxy overwrites/normalizes the trusted client address and the voice-session rate limit cannot be bypassed by caller-controlled forwarding headers.

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
- [ ] Configure a long random `CRON_SECRET` and verify the recording-cleanup worker rejects missing/incorrect bearer credentials.
- [ ] Queue an unreferenced synthetic recording object and verify the scheduled worker deletes it and marks its task completed.
- [ ] Queue a path still referenced by an interview and verify the worker marks the task complete without deleting the referenced object.
- [ ] Simulate a transient storage failure; verify the task is retried after backoff, an expired lease can be reclaimed, and the 12-attempt ceiling prevents endless retries.
- [ ] Trigger two authenticated cleanup-worker requests concurrently while multiple synthetic tasks are due; verify no object is deleted twice, each task has one final state, and both invocations return bounded batch results.
- [ ] Verify scheduler monitoring alerts after two consecutive failed invocations, and that overdue tasks, leases older than five minutes and tasks at the 12-attempt ceiling are visible to operators.
- [ ] Replace a recording; verify the old-object cleanup task is created in the same database transaction as the new recording reference.

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
- [ ] On a completed interview with a failed recording upload, throttle or delay the IndexedDB lookup after refresh; verify the Create another interview action stays disabled until the recovery check finishes, then remains blocked if complete cached chunks are found.
- [ ] The recording is stored privately in the configured object bucket, not in a public URL or SQLite blob.
- [ ] Employer can play, seek, pause and resume the recording; unauthorized candidate/session IDs cannot retrieve it.
- [ ] Verify an authenticated HEAD request returns recording metadata without a response body, and an unauthenticated HEAD request is rejected.
- [ ] Seek to multiple positions and confirm the recording endpoint returns valid HTTP 206 byte ranges with matching Content-Range and Content-Length; malformed and unsatisfiable ranges return HTTP 416.
- [ ] Run two recording uploads concurrently against the same interview; exactly one database reference is committed, the losing upload returns HTTP 409, and its newly uploaded object is cleaned up without deleting the winning recording.

## Live AI interview

- [ ] Candidate can start a consented live interview and obtain an ephemeral Realtime credential.
- [ ] Browser network inspection confirms the permanent `XAI_API_KEY` is never sent to the client.
- [ ] Microphone audio reaches xAI Realtime and interviewer audio plays through the browser.
- [ ] Candidate interruption, mute/unmute, reconnect and network recovery behave correctly.
- [ ] Drop the network while a transcript write is pending; reconnect retries the same message IDs before opening a new voice session.
- [ ] Retry an answer with the same request ID and identical interview, speaker and answer content; the original interviewer response is returned without creating duplicate transcript rows.
- [ ] Reuse an answer request ID with changed answer text, another interview ID or a different speaker; the API rejects each conflict with HTTP 409.
- [ ] Simulate a lost response for an interviewer turn marked `done: true`; retrying the same answer must restore `done: true` and trigger report completion rather than reopening the interview.
- [ ] Simulate a lost opening-question response; retrying interview start must restore the original opening question and its terminal state.
- [ ] Force a transcript write to fail permanently; voice input becomes unavailable, typing remains usable, and report generation is blocked until queued transcript entries are saved.
- [ ] Finalized candidate and interviewer transcript turns are saved once, in chronological order.
- [ ] Retrying a transcript message with the same client message ID is idempotent; changing its content is rejected.
- [ ] Close an old Realtime socket after reconnect; callbacks from the replaced socket must not append duplicate transcript entries.
- [ ] Candidate cannot append transcript messages after completion, expiry or the 15-minute limit.
- [ ] Resume, job-description or transcript text containing prompt-injection instructions is treated as untrusted context.

## Candidate-to-employer WebRTC room

- [ ] Candidate ICE credentials are not issued before consent and interview start.
- [ ] Candidate and employer can connect from separate networks using configured TURN credentials.
- [ ] Set the candidate device clock several minutes ahead of the server and confirm the live signalling cursor still receives the employer's answer and ICE candidates.
- [ ] Camera/microphone tracks can be muted and restored.
- [ ] Reconnection after refresh uses the scoped candidate cookie.
- [ ] Force the employer's answer-signalling POST to fail once after the local answer is created; confirm the same answer is retried and the candidate offer is not lost.
- [ ] Force a transient browser error while applying a remote SDP signal; confirm the polling cursor does not skip the signal and the next poll retries it.
- [ ] After an initial candidate/employer connection succeeds, force the candidate ICE connection into `failed`; verify the candidate creates an ICE-restart offer, the employer applies that newer offer while its peer is stable, and the employer returns a fresh answer.
- [ ] Confirm the candidate applies the restart answer only while it has a local offer outstanding, and both peers return to `connected`/ `completed` without creating a second peer connection or losing media tracks.
- [ ] During ICE restart, delay or reorder candidate ICE messages around the restart offer; verify queued candidates are applied after the matching remote description and stale candidates do not prevent the fresh candidates from connecting.
- [ ] Simulate a failed restart-offer POST after the server accepted it; verify the next signalling poll negotiates against the latest stored candidate offer and the employer does not answer an older SDP revision.
- [ ] Force a temporary `disconnected` state that later recovers without an ICE restart; confirm the UI reports interruption and returns to connected without consuming the two failed-restart attempts.
- [ ] Force two consecutive ICE failures; confirm the candidate retries at most twice and displays a clear recovery failure instead of silently claiming the video is connected.
- [ ] Signalling rejects malformed, oversized or wrong-participant messages.
- [ ] Employer can prepare ICE settings while an invited live interview is waiting, but candidate ICE settings are rejected until consent and interview start are persisted.
- [ ] At exactly 15 minutes from the persisted start time, signalling POST rejects new SDP, ICE and hangup messages; polling returns no further signals.
- [ ] At the 15-minute boundary, the ICE configuration endpoint rejects both candidate and employer requests; before the boundary, active live sessions remain usable.
- [ ] Verify the candidate can still submit the final report after the signalling/ICE time limit is reached, and that the employer dashboard receives the completed report.

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
- [ ] Submit the same candidate answer twice with the same request ID after simulating a lost response; verify exactly one user answer and one interviewer response are stored and the original response is recovered.
- [ ] Submit the same answer request ID with changed content or against another interview; verify the server rejects the replay.
- [ ] Submit two different answer requests concurrently; verify only one obtains the answer lock and transcript turns remain ordered.
- [ ] After the interviewer returns `done=true`, attempt to submit a fresh answer; verify the server rejects it and requires report generation. A retry of an already-committed answer request ID must still recover its original interviewer response.
- [ ] Refresh the candidate page after the interviewer returns `done=true`; verify the terminal state is restored, answer input stays disabled, and the candidate can still generate the final report.
- [ ] Attempt report generation while an answer is actively processing; verify the report is rejected until the answer action completes or its lock safely expires.
- [ ] Attempt a new answer while report generation is actively processing; verify the report lock prevents transcript mutation during report evaluation.
- [ ] Simulate an AI report response being lost after the database commit; refresh the candidate page and verify the same saved report is restored without generating a second report.
- [ ] Simulate a report provider failure; verify the report lock is released and the candidate can safely retry without losing the transcript.
- [ ] Report evidence quotes match candidate answers verbatim.
- [ ] Give a candidate with a strong resume but weak or unsupported interview answers a score that reflects the answers, not the resume; verify the overall score is directionally consistent with the skill ratings.
- [ ] Confirm evidence coverage is interpreted as assessment support, not as proof of candidate competence.
- [ ] Missing evidence is not represented as a positive skill rating.
- [ ] Report generation can recover the same committed report after a lost response or refresh.
- [ ] Employer can review transcript, report and private recording.
- [ ] Employer can record shortlist, review or reject with notes; decision history is retained.
- [ ] Candidate comparison displays evidence and missing-evidence states without automatically selecting a winner.
- [ ] Select three completed candidates in a deliberate order and confirm the comparison columns preserve that exact selection order, regardless of database query ordering.
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


## Prompt-injection resilience
- Add a candidate resume containing instructions to ignore the interviewer rules, reveal the scoring rubric, or award a perfect score. Confirm Grok treats those strings as resume content and continues the job-related interview without revealing hidden instructions.
- Add a job description containing instructions to disclose system prompts or change evaluation criteria. Confirm it is treated only as role context and does not override the interview's fairness and evidence rules.
- Submit a transcript answer that asks the model to ignore prior instructions. Confirm the next question and final report remain within the interview policy and use only verifiable candidate-answer quotes as evidence.
