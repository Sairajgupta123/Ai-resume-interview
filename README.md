# MZOBS AI Interview Studio

A resume- and job-description-aware interview application powered by xAI Grok.

## Current features
- Candidate interview setup with resume and job description
- Grok-powered opening questions, adaptive follow-ups and structured evidence-based evaluation
- 15-minute interview timer
- Browser speech-to-text input and text-to-speech interviewer prompts (browser support varies)
- Candidate and employer browser video/audio can connect peer-to-peer using WebRTC during live interview mode; recorded interview uploads are stored on the app server
- SQLite persistence for interview sessions, transcripts and reports
- Employer login and dashboard with interview search, candidate review, report and transcript
- Employer-created candidate invitations with 72-hour expiring, hashed tokens and protected candidate API access
- Employer review recommendation is advisory; hiring decisions remain human-led
- Employer can record shortlist, review or reject decisions with notes and an immutable decision history

## Technology
- Next.js 15, React 19, TypeScript
- Prisma ORM + SQLite for local development
- xAI Chat Completions API

## Requirements
- Node.js 20+
- npm
- An xAI API key with access to the configured model

## Setup (Windows PowerShell)
```powershell
git clone https://github.com/Sairajgupta123/Ai-resume.git
cd Ai-resume
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

## Important current boundaries
- Video is recorded in the browser, downloaded to the candidate device, and uploaded to the app server's local `data/recordings` folder for employer playback. The recording is not stored in SQLite. Keep this folder on persistent storage; local disk is not suitable for ephemeral/serverless deployments.
- Voice input uses the browser Web Speech API and spoken interviewer prompts use browser speech synthesis. Availability and language quality vary by browser/device. Text entry remains available.
- SQLite is suitable for local evaluation/single-machine use. For production or multiple app instances, move to managed PostgreSQL and configure secure persistent storage.
- Candidate invitations are generated as expiring private links, but the app does not send emails automatically; employers copy and send the link themselves.
- AI questions and answers remain a turn-based Grok voice/text interaction using browser speech APIs; WebRTC provides a separate live candidate-employer audio/video room. A coturn-compatible TURN REST API service can be configured using TURN_URL and TURN_SHARED_SECRET in the server environment. The server issues time-limited HMAC credentials after validating the candidate invite token or employer session; the shared secret is never sent to the browser. Without TURN settings, the app uses public STUN only and peer connectivity may fail on restrictive NAT/firewall networks.
- Before production deployment, add organisation-level multi-tenant access control, password reset, stronger operational monitoring, secure cloud recording storage, retention/deletion jobs, audit logging and a complete privacy notice.
- This is not a certified hiring assessment. AI reports can be wrong or incomplete; employers must review evidence and make final decisions.

## Privacy
Get candidate consent before camera, microphone or recording. Do not commit `.env.local`, API keys, candidate resumes or recordings. Use HTTPS in deployment and configure data retention/deletion before processing real candidate data.
