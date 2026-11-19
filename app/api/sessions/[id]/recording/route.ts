import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { hasValidCandidateInvitation } from "@/lib/invitation";

export const runtime = "nodejs";
const MAX_BYTES = 100 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    const interview = await db.interview.findUnique({ where: { id }, select: { id: true, recordingPath: true, invitationTokenHash: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    const employer = await isEmployerAuthenticated();
    const candidate = await hasValidCandidateInvitation(id, request.headers.get("x-interview-invite"));
    if (!employer && !candidate) return NextResponse.json({ error: "Unauthorized recording upload." }, { status: 401 });

    const form = await request.formData();
    const file = form.get("recording");
    if (!(file instanceof File)) return NextResponse.json({ error: "Recording file is required." }, { status: 400 });
    const mimeType = file.type.split(";")[0].trim();
    if (!["video/webm", "video/mp4", "video/quicktime"].includes(mimeType)) {
      return NextResponse.json({ error: "Only WebM or MP4 recordings are accepted." }, { status: 415 });
    }
    if (file.size < 1 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Recording must be smaller than 100 MB." }, { status: 413 });
    }

    const directory = join(process.cwd(), "data", "recordings");
    await mkdir(directory, { recursive: true });
    const extension = mimeType === "video/mp4" ? ".mp4" : mimeType === "video/quicktime" ? ".mov" : ".webm";
    const filename = `${id}-${Date.now()}${extension}`;
    const absolutePath = join(directory, filename);
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    if (interview.recordingPath) {
      const oldPath = join(process.cwd(), interview.recordingPath);
      await unlink(oldPath).catch(() => undefined);
    }
    await db.interview.update({ where: { id }, data: { recordingPath: `data/recordings/${filename}` } });
    return NextResponse.json({ ok: true, message: "Recording saved securely on this server." });
  } catch {
    return NextResponse.json({ error: "Could not save recording on the server." }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await context.params;
  const interview = await db.interview.findUnique({ where: { id }, select: { recordingPath: true } });
  if (!interview?.recordingPath) return NextResponse.json({ error: "No recording is available." }, { status: 404 });
  try {
    const absolutePath = join(process.cwd(), interview.recordingPath);
    const file = await readFile(absolutePath);
    const contentType = interview.recordingPath.endsWith(".mp4") ? "video/mp4" : interview.recordingPath.endsWith(".mov") ? "video/quicktime" : "video/webm";
    return new NextResponse(file, { headers: { "Content-Type": contentType, "Content-Length": String(file.byteLength), "Content-Disposition": "inline", "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Recording file is missing from server storage." }, { status: 404 });
  }
}
