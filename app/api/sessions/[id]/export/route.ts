import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { normalizeReportForExport } from "@/lib/report-export-policy.mjs";

type Context = { params: Promise<{ id: string }> };

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = typeof value !== "number" && /^[\t\r\n ]*[-=+@]/.test(raw) ? "'" + raw : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(_request: Request, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  try {
    const interview = await db.interview.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        decisionHistory: { orderBy: { createdAt: "asc" } }
      }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });

    const report = normalizeReportForExport(interview.reportJson);
    const rows: unknown[][] = [
      ["MZOBS AI INTERVIEW REPORT"],
      ["Candidate", interview.candidateName],
      ["Role", interview.role],
      ["Interview mode", interview.mode],
      ["Status", interview.status],
      ["Duration (seconds)", interview.durationSeconds],
      ["Created at", interview.createdAt.toISOString()],
      ["Overall score", interview.overallScore],
      ["AI recommendation", interview.recommendation],
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
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    const filename = `mzobs-interview-${interview.id}.csv`;
    return new NextResponse("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch {
    return NextResponse.json({ error: "Could not export interview report." }, { status: 500 });
  }
}
