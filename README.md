# MZOBS AI Interview Studio

A Next.js starter for resume- and job-description-aware AI interviews, powered by xAI Grok.

## Included in this MVP
- Candidate setup form for name, role, resume text and job description
- Grok-powered interview opening, adaptive follow-up questions and structured evaluation report
- 15-minute session timer and transcript
- Browser text-to-speech for interviewer prompts
- Browser speech recognition for voice answer input (support varies by browser)
- Camera/microphone permission flow and local MediaRecorder download
- Employer-style report view with score, strengths, development areas, skills and question evidence
- Server-side API key handling

## Stack
- Next.js 15, React 19, TypeScript
- xAI Chat Completions API

## Run locally
1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Set `XAI_API_KEY` in `.env.local`.
5. Optionally set `XAI_MODEL` to a model enabled for your xAI account.
6. Run `npm run dev` and open http://localhost:3000.

## MVP boundaries
- Camera preview and MediaRecorder are browser-local. Video is downloaded to the candidate's device; it is not uploaded or stored on a server.
- Browser speech recognition availability and accuracy depend on browser, OS, and language support. Typed answers remain available.
- The report is displayed in the current session and can be downloaded as JSON. This is not yet a production multi-tenant employer dashboard.
- Authentication, employer/candidate roles, database persistence, secure cloud recording storage, deletion/retention workflows, PDF export, and production-grade real-time WebRTC transport are follow-up work.
- AI recommendations are advisory only. A human employer must review evidence and make the final decision.

## Privacy and security
- Never commit `.env.local`, API keys, candidate resumes, or interview recordings.
- Obtain explicit candidate consent before using camera, microphone, or recording.
- Before production, add authenticated access, encryption at rest/in transit, retention controls, deletion workflows, audit logs, and a privacy notice.
