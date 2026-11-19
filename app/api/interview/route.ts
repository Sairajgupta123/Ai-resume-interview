import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasValidCandidateInvitation } from "@/lib/invitation";

export const runtime = "nodejs";

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
- End when there is enough evidence or the session is complete. For report action return ONLY JSON with keys: overallScore (0-100), recommendation ("Strong match"|"Consider"|"Needs review"), summary, strengths (string array), improvementAreas (string array), skills (array of {"skill":string,"rating":"Strong"|"Good"|"Developing"|"Insufficient evidence","evidence":string}), questionFeedback (array of {"question":string,"assessment":string,"evidence":string}), and disclaimer.
- Do not fabricate evidence. Use "Insufficient evidence" where appropriate. Recommendation is advisory; employer makes the final decision.`;

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Payload;
    if (!body.action) return NextResponse.json({ error: "Missing action." }, { status: 400 });
    if (body.sessionId) {
      const session = await db.interview.findUnique({ where: { id: body.sessionId }, select: {
        invitationTokenHash: true, candidateName: true, role: true, resumeText: true, jobDescription: true, mode: true
      } });
      if (!session) return NextResponse.json({ error: "Interview session not found." }, { status: 404 });
      if (session.invitationTokenHash && !(await hasValidCandidateInvitation(body.sessionId, request.headers.get("x-interview-invite")))) return NextResponse.json({ error: "Invalid or expired candidate invitation." }, { status: 401 });
      if (session.invitationTokenHash) {
        body.candidateName = session.candidateName;
        body.role = session.role;
        body.resume = session.resumeText;
        body.jobDescription = session.jobDescription;
        body.mode = session.mode === "recorded" ? "recorded" : "live";
      }
      if (body.action === "start") await db.interview.update({ where: { id: body.sessionId }, data: { status: "in_progress", inviteUsedAt: new Date() } });
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
      if (body.sessionId) await (await import("@/lib/db")).db.interviewMessage.create({ data: { interviewId: body.sessionId, role: "assistant", content: String(parsed.message || "") } });
      return NextResponse.json(parsed);
    }

    if (body.action === "answer") {
      const history = (body.history || []).slice(-18);
      const messages = [
        { role: "system" as const, content: SYSTEM },
        { role: "user" as const, content: `Interview context:\n${context}\nContinue the interview. Return JSON only.` },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: body.answer || "" }
      ];
      const content = await askGrok(messages);
      const parsed = parseJson(content);
      if (body.sessionId) {
        const { db } = await import("@/lib/db");
        await db.interviewMessage.createMany({ data: [
          { interviewId: body.sessionId, role: "user", content: String(body.answer || "").slice(0, 12000) },
          { interviewId: body.sessionId, role: "assistant", content: String(parsed.message || "").slice(0, 12000) }
        ] });
      }
      return NextResponse.json(parsed);
    }

    if (body.action === "report") {
      const history = (body.history || []).slice(-40);
      const content = await askGrok([
        { role: "system", content: SYSTEM },
        { role: "user", content: `Generate the employer-facing evidence-based interview report from this context and transcript. Do not infer anything from video or voice appearance.\n${context}\nTranscript:\n${history.map(m => `${m.role}: ${m.content}`).join("\n")}\nReturn report JSON only.` }
      ]);
      const report = parseJson(content);
      if (body.sessionId) {
        const { db } = await import("@/lib/db");
        await db.interview.update({ where: { id: body.sessionId }, data: {
          reportJson: JSON.stringify(report),
          overallScore: Math.max(0, Math.min(100, Math.round(Number(report.overallScore) || 0))),
          recommendation: String(report.recommendation || "Needs review").slice(0, 80),
          status: "completed"
        } });
      }
      return NextResponse.json(report);
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}