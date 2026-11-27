import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { buildCandidateComparison } from "@/lib/candidate-comparison-policy.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: "A JSON comparison request is required." }, { status: 415, headers });
    }
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      const size = Number(declaredLength);
      if (!Number.isSafeInteger(size) || size < 0) return NextResponse.json({ error: "Invalid request content length." }, { status: 400, headers });
      if (size > 4_096) return NextResponse.json({ error: "Comparison request is too large." }, { status: 413, headers });
    }
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "A comparison request body is required." }, { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 4_096) {
        await reader.cancel().catch(() => undefined);
        return NextResponse.json({ error: "Comparison request is too large." }, { status: 413, headers });
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return NextResponse.json({ error: "Invalid JSON comparison request." }, { status: 400, headers });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid comparison request." }, { status: 400, headers });
    }
    const rawIds: unknown[] = Array.isArray((body as { interviewIds?: unknown }).interviewIds)
      ? (body as { interviewIds: unknown[] }).interviewIds
      : [];
    if (rawIds.length < 2 || rawIds.length > 3 ||
        rawIds.some(id => typeof id !== "string" || !id.trim() || id.length > 128) ||
        new Set(rawIds).size !== rawIds.length) {
      return NextResponse.json({ error: "Select two or three different valid candidates." }, { status: 400, headers });
    }
    const ids = rawIds as string[];
    const interviews = await db.interview.findMany({
      where: { id: { in: ids }, status: "completed" },
      select: {
        id: true, candidateName: true, role: true, overallScore: true,
        recommendation: true, reportJson: true
      }
    });
    if (interviews.length !== ids.length) {
      return NextResponse.json({ error: "One or more selected interviews are unavailable or incomplete." }, { status: 404, headers });
    }
    // Prisma does not guarantee that findMany preserves the order of the
    // requested IDs. Restore the employer's selection order so comparison
    // columns remain aligned with the order in which candidates were selected.
    const interviewById = new Map(interviews.map(interview => [interview.id, interview]));
    const orderedInterviews = ids.map(id => interviewById.get(id)!);
    const result = buildCandidateComparison(orderedInterviews);
    return NextResponse.json({ comparison: result }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Select") || message.startsWith("Every selected")) {
      return NextResponse.json({ error: message }, { status: 400, headers });
    }
    return NextResponse.json({ error: "Could not compare the selected candidates." }, { status: 500, headers });
  }
}
