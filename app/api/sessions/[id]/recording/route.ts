import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, recordingPath: true, status: true }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    if (interview.status === "completed") {
      return NextResponse.json({ error: "Recording uploads are closed for completed interviews." }, { status: 409 });
    }

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

    const bytes = Buffer.from(await file.arrayBuffer());
    const isWebm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const isMp4 = bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
    if ((mimeType === "video/webm" && !isWebm) || (mimeType !== "video/webm" && !isMp4)) {
      return NextResponse.json({ error: "Recording file content does not match its declared video format." }, { status: 415 });
    }

    const directory = join(process.cwd(), "data", "recordings");
    await mkdir(directory, { recursive: true });
    const extension = mimeType === "video/mp4" ? ".mp4" : mimeType === "video/quicktime" ? ".mov" : ".webm";
    const filename = `${randomUUID()}${extension}`;
    const relativePath = `data/recordings/${filename}`;
    const absolutePath = join(directory, filename);
    await writeFile(absolutePath, bytes, { flag: "wx" });

    // Atomically refuse a late upload if the report completed while the file was uploading.
    const saved = await db.interview.updateMany({
      where: { id, status: { not: "completed" } },
      data: { recordingPath: relativePath }
    });
    if (saved.count !== 1) {
      await unlink(absolutePath).catch(() => undefined);
      return NextResponse.json({ error: "This interview has ended; the recording was not changed." }, { status: 409 });
    }

    if (interview.recordingPath) {
      const oldName = interview.recordingPath.replace(/\\\\/g, "/").split("/").pop();
      if (oldName && oldName === interview.recordingPath.replace(/\\\\/g, "/").split("/").pop()) {
        const oldPath = join(directory, oldName);
        if (oldPath !== absolutePath) await unlink(oldPath).catch(() => undefined);
      }
    }
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
    const storedPath = interview.recordingPath.replace(/\\\\/g, "/");
    const filename = storedPath.split("/").pop() || "";
    if (storedPath !== `data/recordings/${filename}` || !/^[a-f0-9-]+\\.(webm|mp4|mov)$/i.test(filename)) {
      return NextResponse.json({ error: "Recording storage reference is invalid." }, { status: 500 });
    }
    const absolutePath = join(process.cwd(), "data", "recordings", filename);
    const file = await readFile(absolutePath);
    const contentType = filename.endsWith(".mp4") ? "video/mp4" : filename.endsWith(".mov") ? "video/quicktime" : "video/webm";
    return new NextResponse(file, { headers: { "Content-Type": contentType, "Content-Length": String(file.byteLength), "Content-Disposition": "inline", "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Recording file is missing from server storage." }, { status: 404 });
  }
}
