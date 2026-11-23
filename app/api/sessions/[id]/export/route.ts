import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { normalizeReportForExport, safeCsvCell } from "@/lib/report-export-policy.mjs";
import { isRestorableInterviewReport } from "@/lib/report-recovery-policy.mjs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  const { id } = await context.params;
  try {
    const interview = await db.interview.findUnique({
      where: { id },
      select: {
        id: true, candidateName: true, role: true, mode: true, status: true,
        durationSeconds: true, createdAt: true, overallScore: true,
        recommendation: true, employerDecision: true, employerNotes: true,
        reportJson: true,
        messages: {
          orderBy: { createdAt: "asc" },
          take: 200,
          select: { role: true, content: true, createdAt: true }
        },
        decisionHistory: {
          orderBy: { createdAt: "asc" },
          take: 100,
          select: { decision: true, notes: true, createdAt: true }
        }
      }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers });
    if (interview.status !== "completed" || !interview.reportJson) {
      return NextResponse.json({ error: "Only completed interviews with a report can be exported." }, { status: 409, headers });
    }

    let parsedReport: unknown;
    try {
      parsedReport = JSON.parse(interview.reportJson);
    } catch {
      return NextResponse.json({ error: "The saved interview report is invalid and cannot be exported." }, { status: 409, headers });
    }
    if (!isRestorableInterviewReport(parsedReport)) {
      return NextResponse.json({ error: "The saved interview report failed validation and cannot be exported." }, { status: 409, headers });
    }
    const report = normalizeReportForExport(parsedReport);
    const rows: unknown[][] = [
      ["MZOBS AI INTERVIEW REPORT"],
      ["Candidate", interview.candidateName],
      ["Role", interview.role],
      ["Interview mode", interview.mode],
      ["Status", interview.status],
      ["Duration (seconds)", interview.durationSeconds],
      ["Created at", interview.createdAt.toISOString()],
      ["Overall score", parsedReport.overallScore],
      ["AI recommendation", parsedReport.recommendation],
      ["Employer decision", interview.employerDecision],
      ["Employer notes", interview.employerNotes],
      ["Summary", report.summary || ""],
      [],
      ["SKILL ASSESSMENT"],
      ["Skill", "Rating", "Evidence"],
      ...report.skills.map(skill => [skill.skill, skill.rating, skill.evidence]),
      [],
      ["QUESTION FEEDBACK"],
      ["Question", "Assessment", "Evidence"],
      ...report.questionFeedback.map(item => [item.question, item.assessment, item.evidence]),
      [],
      ["STRENGTHS"],
      ...report.strengths.map(value => [value]),
      [],
      ["DEVELOPMENT AREAS"],
      ...report.improvementAreas.map(value => [value]),
      [],
      ["EMPLOYER DECISION HISTORY"],
      ["Decision", "Notes", "Date"],
      ...interview.decisionHistory.map(item => [item.decision, item.notes, item.createdAt.toISOString()]),
      [],
      ["INTERVIEW TRANSCRIPT"],
      ["Speaker", "Message", "Timestamp"],
      ...interview.messages.map(message => [message.role === "assistant" ? "AI interviewer" : "Candidate", message.content, message.createdAt.toISOString()])
    ];
    const csv = rows.map(row => row.map(safeCsvCell).join(",")).join("\r\n");
    const filename = `mzobs-interview-${interview.id}.csv`;
    return new NextResponse("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0"
      }
    });
  } catch {
    return NextResponse.json({ error: "Could not export interview report." }, { status: 500, headers });
  }
}
