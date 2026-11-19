import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasValidCandidateInvitation } from "@/lib/invitation";

export const runtime = "nodejs";
const INTERVIEW_LIMIT_SECONDS = 15 * 60;

type Message = { role: "assistant" | "user"; content: string };
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
  consentAccepted?: boolean;
};

const SYSTEM = `You are MZOBS, a professional and fair AI interviewer. Conduct a structured 15-minute interview tailored to the candidate resume and job description.
Rules:
- Ask one question at a time, concise and natural.
- Start with a warm welcome, then ask the first question.
- Mix resume/project validation, role-specific technical questions, problem solving and situational questions.
- Adapt follow-ups to the candidate's actual answer. Do not repeat questions.
- Never infer competence, honesty, emotion, age, gender, disability, race, attractiveness, or personality from face, voice tone, accent, or appearance.
- Evaluate only job-related content and evidence in answers. Be respectful and do not reveal hidden scoring rubrics.
- For start/answer actions return ONLY valid JSON: {"message":"the next interviewer utterance","done":false,"focus":"short topic label"}.
- End when there is enough evidence or the session is complete. For report action return ONLY JSON with keys: overallScore (integer 0-100), recommendation ("Strong match"|"Consider"|"Needs review"), summary, strengths (string array), improvementAreas (string array), skills (array of {"skill":string,"rating":"Strong"|"Good"|"Developing"|"Insufficient evidence","evidence":string}), questionFeedback (array of {"question":string,"assessment":string,"evidence":string}), and disclaimer.
- For every skill and questionFeedback evidence field, provide a short VERBATIM quote copied exactly from a candidate answer in the transcript. If no supporting answer exists, use exactly "Insufficient evidence". Never use an interviewer question, resume text, job description, or assumptions as candidate-answer evidence.
- Do not fabricate evidence. Recommendation is advisory; employer makes the final decision.`;

async function askGrok(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is missing. Add it to .env.local.");
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || "grok-3-mini",
      messages,
      temperature: 0.45
    }),
    cache: "no-store"
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Grok API error (${response.status}): ${detail.slice(0, 500)}`);
  }
  const data = await response.json();
  return String(data.choices?.[0]?.message?.content || "");
}

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("AI returned an unexpected response. Please try again.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function elapsedSeconds(startedAt: Date) {
  return Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
}

function normalizeEvidence(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
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
  const recommendations = ["Strong match", "Consider", "Needs review"];
  if (!recommendations.includes(raw.recommendation)) {
    throw new Error("AI report validation failed: recommendation is not supported.");
  }
  const candidateText = normalizeEvidence(candidateAnswers.join(" "));
  const validateEvidence = (value: unknown, field: string) => {
    const evidence = boundedText(value, field, 1200);
    if (evidence === "Insufficient evidence") return evidence;
    const normalized = normalizeEvidence(evidence);
    if (normalized.length < 4 || !candidateText.includes(normalized)) {
      throw new Error(`AI report validation failed: ${field} is not an exact quote from a candidate answer.`);
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
    return {
      skill: boundedText(item.skill, `skills[${index}].skill`, 120),
      rating: item.rating,
      evidence: validateEvidence(item.evidence, `skills[${index}].evidence`)
    };
  });
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
  return {
    overallScore: raw.overallScore,
    recommendation: raw.recommendation,
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
    const body = (await request.json()) as Payload;
    if (!["start", "answer", "report"].includes(body.action)) {
      return NextResponse.json({ error: "Unsupported interview action." }, { status: 400 });
    }

    let startedAt: Date | null = null;
    if (body.sessionId) {
      const session = await db.interview.findUnique({
        where: { id: body.sessionId },
        select: {
          invitationTokenHash: true, status: true, candidateName: true, role: true,
          resumeText: true, jobDescription: true, mode: true, startedAt: true, consentAcceptedAt: true
        }
      });
      if (!session) return NextResponse.json({ error: "Interview session not found." }, { status: 404 });
      if (!session.invitationTokenHash || !(await hasValidCandidateInvitation(body.sessionId, request.headers.get("x-interview-invite")))) {
        return NextResponse.json({ error: "Invalid or expired candidate invitation." }, { status: 401 });
      }
      if (session.status === "completed") return NextResponse.json({ error: "This interview has already been completed." }, { status: 409 });

      body.candidateName = session.candidateName;
      body.role = session.role;
      body.resume = session.resumeText;
      body.jobDescription = session.jobDescription;
      body.mode = session.mode === "recorded" ? "recorded" : "live";
      startedAt = session.startedAt;

      if (body.action === "start") {
        if (body.consentAccepted !== true) {
          return NextResponse.json({ error: "Candidate consent is required before the interview can start." }, { status: 400 });
        }
        if (startedAt) {
          const firstQuestion = await db.interviewMessage.findFirst({
            where: { interviewId: body.sessionId, role: "assistant" },
            orderBy: { createdAt: "asc" },
            select: { content: true }
          });
          if (firstQuestion) return NextResponse.json({ message: firstQuestion.content, done: false, focus: "Interview introduction" });
          // A previous start may have failed after reserving its start timestamp.
          // Permit a retry after a short grace period instead of leaving the invitation stuck.
          if (Date.now() - startedAt.getTime() < 30_000) {
            return NextResponse.json({ error: "Interview is initializing. Please retry in a few seconds." }, { status: 409 });
          }
          startedAt = null;
        }
      } else {
        if (!startedAt) return NextResponse.json({ error: "The interview has not been started." }, { status: 409 });
        if (body.action === "answer" && elapsedSeconds(startedAt) >= INTERVIEW_LIMIT_SECONDS) {
          return NextResponse.json({ error: "The 15-minute interview time limit has been reached. Generate your report to finish." }, { status: 409 });
        }
      }
    }

    if (body.action === "answer") {
      const answer = typeof body.answer === "string" ? body.answer.trim() : "";
      if (!answer) return NextResponse.json({ error: "Please provide an answer before submitting." }, { status: 400 });
      if (answer.length > 12000) return NextResponse.json({ error: "Answer is too long. Please keep it under 12,000 characters." }, { status: 413 });
      body.answer = answer;
    }

    const context = [
      `Candidate: ${body.candidateName || "Candidate"}`,
      `Target role: ${body.role || "Not specified"}`,
      `Interview mode: ${body.mode || "live"}`,
      `Candidate resume text:\n${(body.resume || "").slice(0, 14000)}`,
      `Job description:\n${(body.jobDescription || "").slice(0, 10000)}`
    ].join("\n\n");

    if (body.action === "start") {
      const content = await askGrok([
        { role: "system", content: SYSTEM },
        { role: "user", content: `Begin the interview. Context:\n${context}\nReturn JSON only.` }
      ]);
      const parsed = parseJson(content);
      if (typeof parsed.message !== "string" || !parsed.message.trim()) {
        throw new Error("AI returned an invalid opening question. Please retry.");
      }
      if (body.sessionId) {
        const startedAt = new Date();
        await db.$transaction([
          db.interviewMessage.create({
            data: { interviewId: body.sessionId, role: "assistant", content: parsed.message.slice(0, 12000) }
          }),
          db.interview.update({
            where: { id: body.sessionId },
            data: {
              status: "in_progress",
              inviteUsedAt: startedAt,
              startedAt,
              consentAcceptedAt: startedAt,
              consentVersion: "2026-11-19"
            }
          })
        ]);
      }
      return NextResponse.json(parsed);
    }

    if (body.action === "answer") {
      const history = body.sessionId
        ? await db.interviewMessage.findMany({
            where: { interviewId: body.sessionId },
            orderBy: { createdAt: "asc" }, take: 40,
            select: { role: true, content: true }
          })
        : (body.history || []).slice(-18);
      const messages = [
        { role: "system" as const, content: SYSTEM },
        { role: "user" as const, content: `Interview context:\n${context}\nContinue the interview. Return JSON only.` },
        ...history.map((m) => ({ role: m.role as "assistant" | "user", content: m.content })),
        { role: "user" as const, content: body.answer! }
      ];
      const content = await askGrok(messages);
      const parsed = parseJson(content);
      if (typeof parsed.message !== "string" || !parsed.message.trim()) {
        throw new Error("AI returned an invalid follow-up question. Please retry.");
      }
      if (body.sessionId) {
        if (!startedAt || elapsedSeconds(startedAt) >= INTERVIEW_LIMIT_SECONDS) {
          return NextResponse.json({ error: "The 15-minute interview time limit was reached while processing your answer." }, { status: 409 });
        }
        await db.interviewMessage.createMany({
          data: [
            { interviewId: body.sessionId, role: "user", content: body.answer! },
            { interviewId: body.sessionId, role: "assistant", content: parsed.message.slice(0, 12000) }
          ]
        });
      }
      return NextResponse.json(parsed);
    }

    if (body.action === "report") {
      const history = body.sessionId
        ? await db.interviewMessage.findMany({
            where: { interviewId: body.sessionId },
            orderBy: { createdAt: "asc" }, take: 100,
            select: { role: true, content: true }
          })
        : (body.history || []).slice(-40);
      if (body.sessionId && history.filter(message => message.role === "user").length === 0) {
        return NextResponse.json({ error: "No candidate answers are available to evaluate yet." }, { status: 409 });
      }
      const transcript = history.map(m => `${m.role}: ${m.content}`).join("\n").slice(-24000);
      const content = await askGrok([
        { role: "system", content: SYSTEM },
        { role: "user", content: `Generate the employer-facing evidence-based interview report from this saved server-side transcript. Do not infer anything from video or voice appearance.\n${context}\nTranscript:\n${transcript}\nReturn report JSON only.` }
      ]);
      const rawReport = parseJson(content);
      const candidateAnswers = history.filter(message => message.role === "user").map(message => message.content);
      const report = validateReport(rawReport, candidateAnswers);
      if (body.sessionId) {
        const durationSeconds = startedAt ? Math.min(INTERVIEW_LIMIT_SECONDS, elapsedSeconds(startedAt)) : 0;
        await db.interview.update({
          where: { id: body.sessionId },
          data: {
            reportJson: JSON.stringify(report),
            overallScore: report.overallScore,
            recommendation: report.recommendation,
            durationSeconds,
            status: "completed"
          }
        });
      }
      return NextResponse.json(report);
    }

    return NextResponse.json({ error: "Unsupported interview action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = message.startsWith("AI report validation failed") || message.startsWith("AI returned") ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
