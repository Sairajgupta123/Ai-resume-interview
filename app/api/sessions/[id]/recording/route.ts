import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { hasValidCandidateInvitation } from "@/lib/invitation";

export const runtime = "nodejs";
const MAX_BYTES = 100 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

function remoteStorageConfig() {
  const endpoint = process.env.S3_ENDPOINT?.replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || "auto";
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("Recording storage endpoint must use HTTPS in production.");
  return { endpoint: url, bucket, region, accessKey, secretKey };
}

function hmac(key: Buffer | string, value: string, encoding?: "hex") {
  const result = createHmac("sha256", key).update(value, "utf8");
  return encoding ? result.digest(encoding) : result.digest();
}

function s3RequestUrl(endpoint: URL, bucket: string, key: string) {
  const url = new URL(endpoint.toString());
  const prefix = url.pathname.replace(/\/+$/, "");
  const objectPath = key.split("/").map(encodeURIComponent).join("/");
  url.pathname = prefix + "/" + encodeURIComponent(bucket) + "/" + objectPath;
  return url;
}

async function s3Request(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string) {
  const config = remoteStorageConfig();
  if (!config) throw new Error("Private cloud recording storage is not configured.");
  const url = s3RequestUrl(config.endpoint, config.bucket, key);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body || Buffer.alloc(0)).digest("hex");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(name => name + ":" + headers[name].trim() + "\n").join("");
  const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = dateStamp + "/" + config.region + "/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const dateKey = hmac("AWS4" + config.secretKey, dateStamp) as Buffer;
  const regionKey = hmac(dateKey, config.region) as Buffer;
  const serviceKey = hmac(regionKey, "s3") as Buffer;
  const signingKey = hmac(serviceKey, "aws4_request") as Buffer;
  const signature = hmac(signingKey, stringToSign, "hex") as string;
  headers.authorization = "AWS4-HMAC-SHA256 Credential=" + config.accessKey + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  const response = await fetch(url, { method, headers, body: method === "PUT" ? new Uint8Array(body || Buffer.alloc(0)) : undefined, cache: "no-store" });
  if (!response.ok) throw new Error("Private recording storage returned " + response.status + ": " + (await response.text()).slice(0, 500));
  return response;
}

function isRemoteRecordingPath(value: string) {
  return value.startsWith("s3://");
}

function recordingObjectKey(value: string) {
  const key = value.slice("s3://".length);
  if (!/^recordings\/[a-f0-9-]+\.(webm|mp4|mov)$/i.test(key)) throw new Error("Recording storage reference is invalid.");
  return key;
}

async function saveRecording(bytes: Buffer, contentType: string, filename: string) {
  const config = remoteStorageConfig();
  if (config) {
    const key = "recordings/" + filename;
    await s3Request("PUT", key, bytes, contentType);
    return "s3://" + key;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Configure S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY before accepting production recordings.");
  const directory = join(process.cwd(), "data", "recordings");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), bytes, { flag: "wx" });
  return "data/recordings/" + filename;
}

async function readRecording(storedPath: string) {
  if (isRemoteRecordingPath(storedPath)) {
    const response = await s3Request("GET", recordingObjectKey(storedPath));
    return Buffer.from(await response.arrayBuffer());
  }
  const normalized = storedPath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() || "";
  if (normalized !== "data/recordings/" + filename || !/^[a-f0-9-]+\.(webm|mp4|mov)$/i.test(filename)) throw new Error("Recording storage reference is invalid.");
  return readFile(join(process.cwd(), "data", "recordings", filename));
}

async function deleteRecording(storedPath: string) {
  if (isRemoteRecordingPath(storedPath)) {
    await s3Request("DELETE", recordingObjectKey(storedPath)).catch(() => undefined);
    return;
  }
  const normalized = storedPath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() || "";
  if (normalized === "data/recordings/" + filename && /^[a-f0-9-]+\.(webm|mp4|mov)$/i.test(filename)) await unlink(join(process.cwd(), "data", "recordings", filename)).catch(() => undefined);
}

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

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES + 1024 * 1024) {
      return NextResponse.json({ error: "Recording upload exceeds the 100 MB limit." }, { status: 413 });
    }
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

    const extension = mimeType === "video/mp4" ? ".mp4" : mimeType === "video/quicktime" ? ".mov" : ".webm";
    const filename = randomUUID() + extension;
    const relativePath = await saveRecording(bytes, mimeType, filename);
    const saved = await db.interview.updateMany({
      where: { id, status: { not: "completed" }, recordingPath: interview.recordingPath },
      data: { recordingPath: relativePath }
    });
    if (saved.count !== 1) {
      await deleteRecording(relativePath);
      return NextResponse.json({ error: "The interview changed while this recording was uploading. Please retry." }, { status: 409 });
    }
    if (interview.recordingPath) await deleteRecording(interview.recordingPath);
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
    const storedPath = interview.recordingPath;
    const filename = isRemoteRecordingPath(storedPath) ? recordingObjectKey(storedPath).split("/").pop() || "" : storedPath.split("/").pop() || "";
    const file = await readRecording(storedPath);
    const contentType = filename.endsWith(".mp4") ? "video/mp4" : filename.endsWith(".mov") ? "video/quicktime" : "video/webm";
    return new NextResponse(file, { headers: { "Content-Type": contentType, "Content-Length": String(file.byteLength), "Content-Disposition": "inline", "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Recording file is missing from server storage." }, { status: 404 });
  }
}
