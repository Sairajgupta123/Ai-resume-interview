# MZOBS AI Interview Studio

A resume- and job-description-aware interview application powered by xAI Grok.

## Current features
- Employer-authenticated candidate interview creation and invitation management
- Candidate interview setup with resume and job description
- Grok-powered opening questions, adaptive follow-ups and structured evidence-based evaluation
- 15-minute interview timer
- Browser speech-to-text input and text-to-speech interviewer prompts remain available for recorded interviews and text fallback (browser support varies)
- Live interview mode includes a Grok Realtime speech-to-speech WebSocket client using short-lived candidate-scoped credentials, PCM audio streaming, AI audio playback, interruption handling and saved final transcripts; this integration still requires full browser/provider end-to-end validation
- Candidate and employer browser video/audio can connect peer-to-peer using WebRTC during live interview mode; recordings use private S3-compatible object storage in production and local disk only for development
- SQLite persistence for interview sessions, transcripts and reports
- Employer login and dashboard with interview search, candidate review, report and transcript
- Employer-created candidate invitations with 72-hour expiring, hashed tokens, atomic one-time link exchange, session-scoped HttpOnly cookies and protected candidate API access
- Candidate refresh recovery: invitation tokens are exchanged through a POST request body or the interview-start response for session-scoped HttpOnly cookies; refresh uses the cookie, and in-progress transcripts and elapsed interview time are restored after reload
- Recording resilience: browser recording segments are periodically saved to IndexedDB on the candidate device; if the tab is refreshed or an upload fails, the candidate can recover and upload saved segments before completing the interview
- Live WebRTC signaling authenticates through the same HttpOnly candidate cookie, so a refreshed candidate session can reconnect after granting camera/microphone permission
- Employer dashboard includes private candidate recording playback with loading/error recovery states, browser controls, full-screen support and byte-range streaming for seeking
- AI report validation now rejects duplicate skill entries and rating/evidence mismatches, calculates evidence coverage, and derives conservative recommendations from validated score and evidence coverage rather than trusting the model's recommendation label
- Adaptive interviewer turn validation checks response shape, message length, exactly one question per non-final turn, no question in a final closing statement, and exact normalized prompt repetition
- Adaptive follow-up guidance classifies answer detail signals (specific actions, technical concepts, measurable outcomes and trade-offs) to select clarification, verification or deeper technical probing; these heuristics guide question selection only and do not score candidates
- Interview coverage extracts a bounded set of known skills from the job description and resume, tracks which have been asked and answered from the saved transcript, and guides follow-ups toward unanswered or not-yet-covered job skills; coverage is a planning aid, not a candidate score
- Interview fairness guidance promotes comparable role-related competency coverage, caps repeated questions per skill, prioritizes uncovered skills, and shifts to a respectful wrap-up in the final 90 seconds; it guides interviewer behavior and is not a candidate score
- Employer evidence comparison lets authenticated employers compare two or three completed candidates across the union of reported job-related skills, shows verbatim report evidence, labels missing evidence as insufficient rather than lack of ability, and warns when role labels differ; it does not rank or select a winner
- Employer analytics dashboard summarizes interview volume, completion rate, invited and in-progress sessions, average validated score, six-week activity, human employer decisions, score bands and top roles; analytics are descriptive and do not establish candidate quality or hiring cut-offs
- Automated unit tests cover interview time-limit boundaries, evidence quote integrity, evidence coverage and recommendation calibration, employer login rate-limit policy, employer session-expiry boundaries, candidate invitation expiry/one-time exchange policy, recording MIME/signature/size validation, recording replacement cleanup/failure handling, video byte-range parsing and CSV export formatting/formula-injection protection
- Employer review recommendation is advisory; hiring decisions remain human-led
- Employer can record shortlist, review or reject decisions with notes and an immutable decision history
- Employer decision audit feed displays the latest 100 decision-history events with candidate, role, decision, timestamp and notes; it is an accountability view, not a full security access log
- Employer privacy dashboard provides an authenticated, read-only retention preview for completed interviews using INTERVIEW_RETENTION_DAYS; in-progress sessions are excluded, missing consent metadata is reported, and no records are automatically deleted
- Candidate deletion requests support a 30-minute one-time email verification link (Resend), hashed token storage, attempt limits, separate employer approval and an auditable event trail; approved requests can be executed by an authenticated employer, removing the private recording, transcript, report, interview metadata and related signals/decision history while retaining a minimal anonymized deletion receipt. Failed storage operations remain retryable and never silently mark a request complete. Candidate verification also attempts to clear the interview's IndexedDB recording cache on the browser/device used to open the verification link; a different device cannot remotely clear another browser's local storage.
- Employer privacy deletion requests use candidate identity matching, explicit typed confirmation, one request per interview, duplicate protection, and a separate event history; requests remain pending verification and approval and do not delete candidate data
- Candidate-data storage locations, deletion behavior, external-provider boundaries and a required feature-review checklist are documented in [the privacy data inventory](docs/privacy-data-inventory.md)

## Technology
- Next.js 15, React 19, TypeScript
- Prisma ORM + SQLite for local development
- xAI Chat Completions API and xAI Realtime Speech-to-Speech API

## Requirements
- Node.js 20+
- npm
- An xAI API key with access to the configured model

## Setup (Windows PowerShell)
```powershell
git clone https://github.com/Sairajgupta123/Ai-resume-interview.git
cd Ai-resume-interview
npm install
Copy-Item .env.example .env.local
```

Open `.env.local` and set:
- `XAI_API_KEY`: your xAI API key
- `XAI_MODEL`: a chat model available to your xAI account
- `EMPLOYER_USERNAME`: dashboard login (default example: admin)
- `EMPLOYER_PASSWORD`: replace the example with a strong password
- `SESSION_SECRET`: replace with a random secret of at least 32 characters
- `DATABASE_URL`: keep `file:../dev.db` for local SQLite

Then run:
```powershell
npm run dev
```
The dev command runs Prisma schema sync and starts Next.js. Open http://localhost:3000.

## Employer dashboard
Open http://localhost:3000/dashboard and sign in with `EMPLOYER_USERNAME` and `EMPLOYER_PASSWORD` from `.env.local`. Use **Invite candidate** to create an interview and generate a private link. Copy the link and send it to the candidate manually; outbound email delivery is not configured yet.


- PostgreSQL migration preparation and release gates are documented in [the database migration runbook](docs/postgres-migration-runbook.md); the application still runs SQLite until the migration is tested end to end.

## Important current boundaries
- After candidate consent and camera/microphone permission, audio-video recording starts automatically in both live and recorded modes. Candidates can stop recording; the recording is uploaded over an authenticated endpoint before the report screen is shown. The app warns before leaving while recording or upload is active, but recording segments are also temporarily stored in browser IndexedDB until server upload succeeds. If an upload is interrupted, the candidate can recover locally saved segments from the same browser/device before completing the interview. Browser storage can still be cleared by the user, browser policy or device cleanup, so this is a recovery aid rather than a guaranteed backup. The recording bytes are not stored in SQLite. Local development uses `data/recordings`; production requires private S3-compatible object storage configured with `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. The bucket must remain private; never expose object credentials to the browser. Browser recording support and upload size limits apply (100 MB maximum).
- Live AI voice uses xAI Realtime over a browser WebSocket authenticated with a short-lived ephemeral token; the permanent xAI API key remains server-side. The microphone stream is sent to xAI for real-time speech processing, and finalized candidate/interviewer transcripts are saved to the interview record. Recorded interviews and text fallback continue to use browser speech APIs, whose availability and language quality vary by browser/device. Text entry remains available. The Realtime client is implemented but still needs end-to-end testing with an authorized xAI account and supported browser before production use.
- The current Prisma schema is configured for SQLite. SQLite is suitable for local evaluation and single-machine testing, but this repository does not yet include the PostgreSQL schema/provider migration or a production database migration workflow. Do not point `DATABASE_URL` at PostgreSQL and assume it will work. Before a production or multi-instance launch, migrate the Prisma provider/schema, generate and test database migrations against managed PostgreSQL, and validate backups, connection pooling and concurrent writes. Configure secure private object storage as well: the current S3-compatible adapter uses path-style requests and AWS Signature Version 4; verify endpoint, bucket, region and credentials with a test upload before processing real candidates.
- Candidate invitations are generated as expiring private links, but the app does not send emails automatically; employers copy and send the link themselves.
- Employer dashboard supports filtering, comparing up to three candidates, exporting the interview list to CSV, and downloading a per-candidate report CSV with skill evidence, question feedback, decision history and transcript. Export endpoints require an authenticated employer session.
- Grok Realtime is used for the live candidate-to-AI spoken interview; the turn-based Chat Completions path remains available for text fallback and recorded mode. WebRTC provides a separate candidate-to-employer audio/video room and is not the AI voice transport. A coturn-compatible TURN REST API service can be configured using TURN_URL and TURN_SHARED_SECRET in the server environment. The server issues time-limited HMAC credentials after validating the candidate invite token or employer session; the shared secret is never sent to the browser. Without TURN settings, the app uses public STUN only and peer connectivity may fail on restrictive NAT/firewall networks.
- Before production deployment, add organisation-level multi-tenant access control, password reset, stronger operational monitoring, secure cloud recording storage, retention/deletion jobs, audit logging and a complete privacy notice.
- This is not a certified hiring assessment. AI reports can be wrong or incomplete; employers must review evidence and make final decisions.

## Privacy
Get candidate consent before camera, microphone or recording. Explain that unfinished recording segments are temporarily stored in browser IndexedDB on the candidate's device until upload succeeds. Do not commit `.env.local`, API keys, candidate resumes or recordings. Use HTTPS in deployment and configure data retention/deletion before processing real candidate data.
