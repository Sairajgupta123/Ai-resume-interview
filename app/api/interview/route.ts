import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { candidateInvitationCookieName, getCandidateInvitationToken, hasValidCandidateInvitation } from "@/lib/invitation";
import { elapsedInterviewSeconds, INTERVIEW_LIMIT_SECONDS, isVerifiableEvidenceQuote, restoreChronologicalOrder } from "@/lib/interview-policy.mjs";
import { calculateEvidenceCoverage, deriveRecommendation, hasDuplicateSkills, isRatingEvidenceConsistent } from "@/lib/evaluation-policy.mjs";
import { isRestorableInterviewReport } from "@/lib/report-recovery-policy.mjs";
import { buildBoundedReportTranscript } from "@/lib/report-transcript-policy.mjs";
import { extractGrokAssistantText } from "@/lib/grok-response-policy.mjs";
import { validateInterviewerTurn } from "@/lib/interviewer-turn-policy.mjs";
import { buildAdaptiveGuidance } from "@/lib/adaptive-interview-policy.mjs";
import { buildCoverageGuidance, buildSkillCoverage, extractTargetSkills } from "@/lib/skill-coverage-policy.mjs";
import { buildFairnessGuidance, buildInterviewFairnessPlan } from "@/lib/interview-fairness-policy.mjs";

function attachCandidateCookie(response: NextResponse, request: NextRequest, sessionId: string, expiresAt: Date | null) {
  const token = getCandidateInvitationToken(request, sessionId);
  if (token && expiresAt) {
    response.cookies.set(candidateInvitationCookieName(sessionId), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    });
  }
  return response;
}

export const runtime = "nodejs";
// Keep the provider deadline comfortably below the stale-lock lease.
const GROK_TIMEOUT_MS = 45_000;
const OPERATION_LOCK_STALE_MS = 90_000;


function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  return NextResponse.json(body, { ...init, headers });
}

type Message = { role: "assistant" | "user"; content: string };
async function readBoundedJson(request: NextRequest, maxBytes: number): Promise<{ value: unknown } | { error: string; status: number }> {
  if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return { error: "A JSON request body is required.", status: 415 };
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return { error: "Invalid request content length.", status: 400 };
    }
    if (parsedLength > maxBytes) return { error: "Interview request is too large.", status: 413 };
  }
  const reader = request.body?.getReader();
  if (!reader) return { error: "A request body is required.", status: 400 };
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { error: "Interview request is too large.", status: 413 };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { error: "Could not read interview request.", status: 400 };
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Interview request must be a JSON object.", status: 400 };
    }
    return { value };
  } catch {
    return { error: "Invalid JSON request body.", status: 400 };
  }
}

type Payload = {
  action: "start" | "answer" | "report";
  candidateName?: string;
  role?: string;
  resume?: string;
  jobDescription?: string;
  mode?: "live" | "recorded";
  history?: Message[];
  answer?: string;
  sessionId?: string;
  requestId?: string;
  consentAccepted?: boolean;
};

const SYSTEM = `You are MZOBS, a professional and fair AI interviewer. Conduct a structured 15-minute interview tailored to the candidate resume and job description.
Rules:
- Ask one question at a time, concise and natural.
- Start with a warm welcome, then ask the first question.
- Mix resume/project validation, role-specific technical questions, problem solving and situational questions.
- Adapt follow-ups to the candidate's actual answer. Do not repeat questions.
- Apply fairness guidance: use comparable job-related competency areas and evidence standards for candidates applying to the same role; adapt wording without lowering or raising standards based on personal characteristics.
- Avoid repeatedly testing one skill; respect per-skill question caps and cover remaining job-relevant skills.
- In the final 90 seconds, ask at most one essential clarification and then close the interview with done=true.
- Never infer competence, honesty, emotion, age, gender, disability, race, attractiveness, or personality from face, voice tone, accent, or appearance.
- Evaluate only job-related content and evidence in answers. Be respectful and do not reveal hidden scoring rubrics.
- For start/answer actions return ONLY valid JSON: {"message":"the next interviewer utterance","done":false,"focus":"short topic label"}.
- End when there is enough evidence or the session is complete. For report action return ONLY JSON with keys: overallScore (integer 0-100), recommendation ("Strong match"|"Consider"|"Needs review"), summary, strengths (string array), improvementAreas (string array), skills (array of {"skill":string,"rating":"Strong"|"Good"|"Developing"|"Insufficient evidence","evidence":string}), questionFeedback (array of {"question":string,"assessment":string,"evidence":string}), and disclaimer.
- For every skill and questionFeedback evidence field, provide a short VERBATIM quote copied exactly from a candidate answer in the transcript. If no supporting answer exists, use exactly "Insufficient evidence". Never use an interviewer question, resume text, job description, or assumptions as candidate-answer evidence.
- Do not fabricate evidence. Recommendation is advisory; employer makes the final decision.`;

async function askGrok(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is missing. Add it to .env.local.");
  let response: Response;
  try {
    response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || "grok-3-mini",
        messages,
        temperature: 0.45
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(GROK_TIMEOUT_MS)
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(timedOut
      ? "Grok API error (timeout): provider request exceeded the 45-second deadline."
      : "Grok API error (network): provider request could not be completed.");
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Grok API error (${response.status}): ${detail.slice(0, 500)}`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Grok API error (invalid response): provider returned malformed JSON.");
  }
  return extractGrokAssistantText(data);
}

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("AI returned an unexpected response. Please retry.");
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    throw new Error("AI returned malformed JSON. Please retry.");
  }
}

function boundedText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`AI report validation failed: invalid ${field}.`);
  }
  return value.trim();
}

function validateReport(raw: any, candidateAnswers: string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("AI report validation failed: report must be an object.");
  }
  if (!Number.isInteger(raw.overallScore) || raw.overallScore < 0 || raw.overallScore > 100) {
    throw new Error("AI report validation failed: overall score must be an integer from 0 to 100.");
  }
  const validateEvidence = (value: unknown, field: string) => {
    const evidence = boundedText(value, field, 1200);
    if (!isVerifiableEvidenceQuote(evidence, candidateAnswers)) {
      throw new Error(`AI report validation failed: ${field} is not a contiguous quote from one candidate answer.`);
    }
    return evidence;
  };
  const stringList = (value: unknown, field: string, maxItems: number) => {
    if (!Array.isArray(value) || value.length > maxItems) {
      throw new Error(`AI report validation failed: invalid ${field} list.`);
    }
    return value.map((item, index) => boundedText(item, `${field}[${index}]`, 500));
  };
  if (!Array.isArray(raw.skills) || raw.skills.length > 30) {
    throw new Error("AI report validation failed: invalid skills list.");
  }
  const ratings = ["Strong", "Good", "Developing", "Insufficient evidence"];
  const skills = raw.skills.map((item: any, index: number) => {
    if (!item || typeof item !== "object" || !ratings.includes(item.rating)) {
      throw new Error(`AI report validation failed: invalid skill rating at item ${index + 1}.`);
    }
    const skill = boundedText(item.skill, `skills[${index}].skill`, 120);
    const evidence = validateEvidence(item.evidence, `skills[${index}].evidence`);
    if (!isRatingEvidenceConsistent(item.rating, evidence)) {
      throw new Error(`AI report validation failed: rating/evidence mismatch for skill ${index + 1}.`);
    }
    return { skill, rating: item.rating, evidence };
  });
  if (hasDuplicateSkills(skills)) {
    throw new Error("AI report validation failed: duplicate or empty skill names.");
  }
  if (!Array.isArray(raw.questionFeedback) || raw.questionFeedback.length > 40) {
    throw new Error("AI report validation failed: invalid question feedback list.");
  }
  const questionFeedback = raw.questionFeedback.map((item: any, index: number) => {
    if (!item || typeof item !== "object") {
      throw new Error(`AI report validation failed: invalid question feedback at item ${index + 1}.`);
    }
    return {
      question: boundedText(item.question, `questionFeedback[${index}].question`, 1000),
      assessment: boundedText(item.assessment, `questionFeedback[${index}].assessment`, 1500),
      evidence: validateEvidence(item.evidence, `questionFeedback[${index}].evidence`)
    };
  });
  const evidenceCoverage = calculateEvidenceCoverage([...skills, ...questionFeedback]);
  return {
    overallScore: raw.overallScore,
    // The provider's recommendation is advisory input only. Derive the displayed
    // recommendation from the validated score and the report's evidence coverage.
    recommendation: deriveRecommendation(raw.overallScore, evidenceCoverage),
    evidenceCoverage,
    summary: boundedText(raw.summary, "summary", 3000),
    strengths: stringList(raw.strengths, "strengths", 12),
    improvementAreas: stringList(raw.improvementAreas, "improvementAreas", 12),
    skills,
    questionFeedback,
    disclaimer: boundedText(raw.disclaimer, "disclaimer", 1000)
  };
}

export async function POST(request: NextRequest) {
  try {
    // Start requests include resume and job-description text; 40 KB is ample
    // for the validated fields while preventing unbounded JSON buffering.
    const parsedRequest = await readBoundedJson(request, 40 * 1024);
    if ("error" in parsedRequest) {
      return privateJson({ error: parsedRequest.error }, { status: parsedRequest.status });
    }
    const body = parsedRequest.value as Payload;
    if (!["start", "answer", "report"].includes(body.action)) {
      return privateJson({ error: "Unsupported interview action." }, { status: 400 });
    }

    // Every AI operation must belong to a persisted interview and a valid candidate
    // invitation. Do not expose an anonymous Grok proxy that can be abused for API spend.
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      return privateJson({ error: "A valid interview invitation is required." }, { status: 401 });
    }

    if (body.action === "start" && body.consentAccepted !== true) {
      return privateJson({ error: "Candidate consent is required before the interview can start." }, { status: 400 });
    }

    let startedAt: Date | null = null;
    let invitationExpiresAt: Date | null = null;
    let startLockAt: Date | null = null;
    if (body.sessionId) {
      const session = await db.interview.findUnique({
        where: { id: body.sessionId },
        select: {
          invitationTokenHash: true, status: true, candidateName: true, role: true,
          resumeText: true, jobDescription: true, mode: true, startedAt: true, consentAcceptedAt: true, inviteExpiresAt: true
        }
      });
      if (!session) return privateJson({ error: "Interview session not found." }, { status: 404 });
      if (!session.invitationTokenHash || !(await hasValidCandidateInvitation(body.sessionId, getCandidateInvitationToken(request, body.sessionId)))) {
        return privateJson({ error: "Invalid or expired candidate invitation." }, { status: 401 });
      }
      if (session.status === "completed" && body.action !== "report") {
        return privateJson({ error: "This interview has already been completed." }, { status: 409 });
      }
      if (session.status === "completed" && body.action === "report") {
        const completed = await db.interview.findUnique({
          where: { id: body.sessionId },
          select: { reportJson: true }
        });
        if (!completed?.reportJson) {
          return privateJson({ error: "The completed interview report is unavailable. Contact the hiring team." }, { status: 409 });
        }
        try {
          const savedReport: unknown = JSON.parse(completed.reportJson);
          if (!isRestorableInterviewReport(savedReport)) throw new Error("Invalid saved report");
          return attachCandidateCookie(privateJson(savedReport, {
            headers: { "Cache-Control": "private, no-store, max-age=0" }
          }), request, body.sessionId, session.inviteExpiresAt);
        } catch {
          return privateJson({ error: "The saved interview report could not be restored. Contact the hiring team." }, { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
        }
      }

      body.candidateName = session.candidateName;
      body.role = session.role;
      body.resume = session.resumeText;
      body.jobDescription = session.jobDescription;
      body.mode = session.mode === "recorded" ? "recorded" : "live";
      startedAt = session.startedAt;
      invitationExpiresAt = session.inviteExpiresAt;

      if (body.action === "start") {
        if (startedAt) {
          const firstQuestion = await db.interviewMessage.findFirst({
            where: { interviewId: body.sessionId, role: "assistant" },
            orderBy: { createdAt: "asc" },
            select: { content: true }
          });
          if (firstQuestion) {
            const response = privateJson({ message: firstQuestion.content, done: false, focus: "Interview introduction" });
            return attachCandidateCookie(response, request, body.sessionId, invitationExpiresAt);
          }
          return privateJson({ error: "Interview initialization is incomplete. Please contact the hiring team." }, { status: 409 });
        }
        const lockAt = new Date();
        const lock = await db.interview.updateMany({
          where: {
            id: body.sessionId,
            startedAt: null,
            OR: [{ startLockAt: null }, { startLockAt: { lt: new Date(Date.now() - OPERATION_LOCK_STALE_MS) } }]
          },
          data: { startLockAt: lockAt, consentAcceptedAt: lockAt, consentVersion: "2026-11-19" }
        });
        if (lock.count !== 1) {
          const existingQuestion = await db.interviewMessage.findFirst({
            where: { interviewId: body.sessionId, role: "assistant" },
            orderBy: { createdAt: "asc" },
            select: { content: true }
          });
          if (existingQuestion) return privateJson({ message: existingQuestion.content, done: false, focus: "Interview introduction" });
          return privateJson({ error: "Interview is already initializing. Please wait a moment and retry." }, { status: 409 });
        }
        startLockAt = lockAt;
      } else {
        if (!startedAt) return privateJson({ error: "The interview has not been started." }, { status: 409 });
      }
    }

    if (body.action === "answer") {
      const answer = typeof body.answer === "string" ? body.answer.trim() : "";
      if (!answer) return privateJson({ error: "Please provide an answer before submitting." }, { status: 400 });
      if (answer.length > 12000) return privateJson({ error: "Answer is too long. Please keep it under 12,000 characters." }, { status: 413 });
      body.answer = answer;
      if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
        return privateJson({ error: "A valid answer request ID is required. Please retry." }, { status: 400 });
      }
      // If the previous response was lost after the transaction committed, return
      // the saved interviewer turn rather than evaluating or storing the answer twice.
      const previousAnswer = await db.interviewMessage.findUnique({
        where: { clientMessageId: body.requestId },
        select: { interviewId: true, role: true, createdAt: true }
      });
      if (previousAnswer) {
        if (previousAnswer.interviewId !== body.sessionId || previousAnswer.role !== "user") {
          return privateJson({ error: "This answer request ID has already been used." }, { status: 409 });
        }
        const savedTurn = await db.interviewMessage.findFirst({
          where: {
            interviewId: body.sessionId,
            role: "assistant",
            createdAt: { gt: previousAnswer.createdAt }
          },
          orderBy: { createdAt: "asc" },
          select: { content: true }
        });
        if (!savedTurn) return privateJson({ error: "Your answer is still being processed. Please retry shortly." }, { status: 409 });
        const response = privateJson({
          message: savedTurn.content,
          done: false,
          focus: "Interview follow-up",
          timeLimitReached: !!startedAt && elapsedInterviewSeconds(startedAt) >= INTERVIEW_LIMIT_SECONDS
        });
        return attachCandidateCookie(response, request, body.sessionId!, invitationExpiresAt);
      }
      if (startedAt && elapsedInterviewSeconds(startedAt) >= INTERVIEW_LIMIT_SECONDS) {
        return privateJson({ error: "The 15-minute interview time limit has been reached. Generate your report to finish." }, { status: 409 });
      }
    }

    const context = [
      `Candidate: ${body.candidateName || "Candidate"}`,
      `Target role: ${body.role || "Not specified"}`,
      `Interview mode: ${body.mode || "live"}`,
      `Candidate resume text:\n${(body.resume || "").slice(0, 14000)}`,
      `Job description:\n${(body.jobDescription || "").slice(0, 10000)}`
    ].join("\n\n");

    if (body.action === "start") {
      try {
        const content = await askGrok([
          { role: "system", content: SYSTEM },
          { role: "user", content: `Begin the interview. Context:\n${context}\nReturn JSON only.` }
        ]);
        const parsed = parseJson(content);
        const validatedTurn = validateInterviewerTurn(parsed, []);
        if (!validatedTurn.ok) {
          throw new Error("AI returned an invalid opening question (" + validatedTurn.reason + "). Please retry.");
        }
        Object.assign(parsed, validatedTurn.value);
        if (body.sessionId) {
          if (!startLockAt) throw new Error("Interview start lock was not acquired.");
          const startedAt = new Date();
          await db.$transaction(async (tx) => {
            const current = await tx.interview.findUnique({
              where: { id: body.sessionId },
              select: { startLockAt: true, startedAt: true, status: true }
            });
            if (!current || current.startedAt || current.startLockAt?.getTime() !== startLockAt!.getTime() || current.status === "completed") {
              throw new Error("Interview start request expired. Please retry.");
            }
            await tx.interviewMessage.create({
              data: { interviewId: body.sessionId!, role: "assistant", content: parsed.message.slice(0, 12000) }
            });
            await tx.interview.update({
              where: { id: body.sessionId },
              data: { status: "in_progress", startedAt, startLockAt: null }
            });
          });
        }
        const response = privateJson(parsed);
        return body.sessionId
          ? attachCandidateCookie(response, request, body.sessionId, invitationExpiresAt)
          : response;
      } finally {
        if (body.sessionId && startLockAt) {
          await db.interview.updateMany({
            where: { id: body.sessionId, startLockAt },
            data: { startLockAt: null }
          }).catch(() => undefined);
        }
      }
    }

    if (body.action === "answer") {
      let answerLockAt: Date | null = null;
      if (body.sessionId) {
        const lockAt = new Date();
        const lock = await db.interview.updateMany({
          where: {
            id: body.sessionId,
            status: "in_progress",
            AND: [
              { OR: [{ answerLockAt: null }, { answerLockAt: { lt: new Date(Date.now() - OPERATION_LOCK_STALE_MS) } }] },
              { OR: [{ reportLockAt: null }, { reportLockAt: { lt: new Date(Date.now() - OPERATION_LOCK_STALE_MS) } }] }
            ]
          },
          data: { answerLockAt: lockAt, reportLockAt: null }
        });
        if (lock.count !== 1) {
          return privateJson({ error: "Another interview action is being processed. Please wait and retry." }, { status: 409 });
        }
        answerLockAt = lockAt;
      }
      try {
        const history = body.sessionId
          ? restoreChronologicalOrder(await db.interviewMessage.findMany({
              where: { interviewId: body.sessionId },
              // Fetch the most recent context, then restore chronological order
              // for the model and the interviewer fairness/coverage policies.
              orderBy: { createdAt: "desc" }, take: 40,
              select: { role: true, content: true }
            }))
          : (body.history || []).slice(-18);
        const adaptiveGuidance = buildAdaptiveGuidance(body.answer!);
        const targetSkills = extractTargetSkills(body.jobDescription || "", body.resume || "");
        const coverageHistory = [...history, { role: "user", content: body.answer! }];
        const skillCoverage = buildSkillCoverage(targetSkills, coverageHistory);
        const coverageGuidance = buildCoverageGuidance(skillCoverage);
        const fairnessPlan = buildInterviewFairnessPlan(
          targetSkills,
          coverageHistory,
          startedAt ? elapsedInterviewSeconds(startedAt) : 0,
          INTERVIEW_LIMIT_SECONDS
        );
        const fairnessGuidance = buildFairnessGuidance(fairnessPlan);
        const previousFocuses = history
          .filter(message => message.role === "assistant")
          .map(message => message.content.slice(0, 240));
        const messages = [
          { role: "system" as const, content: SYSTEM },
          {
            role: "user" as const,
            content: `Interview context:\n${context}\nContinue the interview. Return JSON only.\nAdaptive follow-up guidance (${adaptiveGuidance.depth}): ${adaptiveGuidance.instruction}\nJob skill coverage (${skillCoverage.answered}/${skillCoverage.total} answered, ${skillCoverage.percent}%): ${coverageGuidance}\n${fairnessGuidance}\nPreviously covered interviewer turns (avoid repeating the same skill/question):\n${previousFocuses.join("\n")}`
          },
          ...history.map((m) => ({ role: m.role as "assistant" | "user", content: m.content })),
          { role: "user" as const, content: body.answer! }
        ];
        const content = await askGrok(messages);
        const parsed = parseJson(content);
        const previousAssistantMessages = history
          .filter(message => message.role === "assistant")
          .map(message => message.content);
        const validatedTurn = validateInterviewerTurn(parsed, previousAssistantMessages);
        if (!validatedTurn.ok) {
          throw new Error("AI returned an invalid follow-up question (" + validatedTurn.reason + "). Please retry.");
        }
        Object.assign(parsed, validatedTurn.value);
        if (body.sessionId) {
          // The request passed the deadline check before the provider call. Preserve that
          // in-flight answer even if Grok finishes just after the 15-minute boundary.
          if (!startedAt || !answerLockAt) {
            return privateJson({ error: "The interview answer could not be committed. Please retry." }, { status: 409 });
          }
          await db.$transaction(async (tx) => {
            const current = await tx.interview.findUnique({
              where: { id: body.sessionId },
              select: { status: true, answerLockAt: true, startedAt: true }
            });
            if (!current || current.status !== "in_progress" || current.answerLockAt?.getTime() !== answerLockAt!.getTime()) {
              throw new Error("Interview answer request expired. Please retry.");
            }
            const latestMessage = await tx.interviewMessage.findFirst({
              where: { interviewId: body.sessionId },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true }
            });
            const userMessageAt = new Date(Math.max(
              Date.now(),
              (latestMessage?.createdAt.getTime() || 0) + 1
            ));
            const assistantMessageAt = new Date(userMessageAt.getTime() + 1);
            await tx.interviewMessage.createMany({
              data: [
                {
                  interviewId: body.sessionId!,
                  role: "user",
                  content: body.answer!,
                  clientMessageId: body.requestId!,
                  createdAt: userMessageAt
                },
                {
                  interviewId: body.sessionId!,
                  role: "assistant",
                  content: parsed.message.slice(0, 12000),
                  createdAt: assistantMessageAt
                }
              ]
            });
            await tx.interview.update({ where: { id: body.sessionId }, data: { answerLockAt: null } });
          });
          answerLockAt = null;
        }
        return privateJson({
          ...parsed,
          timeLimitReached: !!startedAt && elapsedInterviewSeconds(startedAt) >= INTERVIEW_LIMIT_SECONDS
        });
      } finally {
        if (body.sessionId && answerLockAt) {
          await db.interview.updateMany({
            where: { id: body.sessionId, answerLockAt },
            data: { answerLockAt: null }
          }).catch(() => undefined);
        }
      }
    }

    if (body.action === "report") {
      let reportLockAt: Date | null = null;
      if (body.sessionId) {
        const lockAt = new Date();
        const lock = await db.interview.updateMany({
          where: {
            id: body.sessionId,
            status: "in_progress",
            AND: [
              { OR: [{ answerLockAt: null }, { answerLockAt: { lt: new Date(Date.now() - OPERATION_LOCK_STALE_MS) } }] },
              { OR: [{ reportLockAt: null }, { reportLockAt: { lt: new Date(Date.now() - OPERATION_LOCK_STALE_MS) } }] }
            ]
          },
          data: { reportLockAt: lockAt, answerLockAt: null }
        });
        if (lock.count !== 1) {
          return privateJson({ error: "Another interview action is being processed. Please wait and retry." }, { status: 409 });
        }
        reportLockAt = lockAt;
      }
      try {
        const history = body.sessionId
          ? restoreChronologicalOrder(await db.interviewMessage.findMany({
              where: { interviewId: body.sessionId },
              // Evaluate the most recent bounded transcript, not only its oldest turns.
              orderBy: { createdAt: "desc" }, take: 200,
              select: { role: true, content: true }
            }))
          : (body.history || []).slice(-40);
        if (body.sessionId && history.filter(message => message.role === "user").length === 0) {
          return privateJson({ error: "No candidate answers are available to evaluate yet." }, { status: 409 });
        }
        const boundedTranscript = buildBoundedReportTranscript(history, 24_000);
        if (body.sessionId && !boundedTranscript.messages.some(message => message.role === "user")) {
          return privateJson({ error: "No candidate answers are available in the report context. Please contact the hiring team." }, { status: 409 });
        }
        const transcript = boundedTranscript.transcript;
        const content = await askGrok([
          { role: "system", content: SYSTEM },
          { role: "user", content: `Generate the employer-facing evidence-based interview report from this saved server-side transcript. Do not infer anything from video or voice appearance.\n${context}\nTranscript (complete messages only; ${boundedTranscript.omittedMessages} older messages omitted due to the report context limit):\n${transcript}\nReturn report JSON only.` }
        ]);
        const rawReport = parseJson(content);
        // Evidence is validated against exactly the candidate answers the model saw.
        const candidateAnswers = boundedTranscript.messages
          .filter(message => message.role === "user")
          .map(message => message.content);
        const report = validateReport(rawReport, candidateAnswers);
        if (body.sessionId) {
          if (!reportLockAt) throw new Error("Interview report lock was not acquired.");
          const durationSeconds = startedAt ? Math.min(INTERVIEW_LIMIT_SECONDS, elapsedInterviewSeconds(startedAt)) : 0;
          await db.$transaction(async (tx) => {
            const current = await tx.interview.findUnique({
              where: { id: body.sessionId },
              select: { status: true, reportLockAt: true }
            });
            if (!current || current.status !== "in_progress" || current.reportLockAt?.getTime() !== reportLockAt!.getTime()) {
              throw new Error("Interview report request expired. Please retry.");
            }
            await tx.interview.update({
              where: { id: body.sessionId },
              data: {
                reportJson: JSON.stringify(report),
                overallScore: report.overallScore,
                recommendation: report.recommendation,
                durationSeconds,
                status: "completed",
                reportLockAt: null
              }
            });
          });
          reportLockAt = null;
        }
        const response = privateJson(report, {
          headers: { "Cache-Control": "private, no-store, max-age=0" }
        });
        // Retain the scoped HttpOnly invitation cookie until its original expiry.
        // It allows a candidate to safely recover the committed report after a
        // lost response or browser refresh without exposing the bearer token.
        if (body.sessionId) attachCandidateCookie(response, request, body.sessionId, invitationExpiresAt);
        return response;
      } finally {
        if (body.sessionId && reportLockAt) {
          await db.interview.updateMany({
            where: { id: body.sessionId, reportLockAt },
            data: { reportLockAt: null }
          }).catch(() => undefined);
        }
      }
    }

    return privateJson({ error: "Unsupported interview action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const aiFailure = message.startsWith("AI report validation failed")
      || message.startsWith("AI returned")
      || message.startsWith("Grok API error");
    const clientMessage = aiFailure
      ? "The AI interviewer could not complete this step. Please retry in a moment."
      : "The interview service encountered an unexpected error. Please retry or contact the hiring team.";
    // Do not return upstream provider bodies, infrastructure details or secrets to candidates.
    return privateJson({ error: clientMessage }, { status: aiFailure ? 502 : 500 });
  }
}
