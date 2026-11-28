import { NextRequest, NextResponse } from "next/server";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { join } from "node:path";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { getCandidateInvitationToken, hasValidCandidateSession } from "@/lib/invitation";
import { MAX_RECORDING_BYTES, inspectRecordingUpload, isSafeRecordingFilename } from "@/lib/recording-policy.mjs";
import { commitRecordingReplacement } from "@/lib/recording-replacement.mjs";
import { parseByteRange } from "@/lib/recording-range.mjs";
import { isExpectedRecordingStorageResponse, parseRecordingContentLength } from "@/lib/recording-storage-response.mjs";
import { deleteStoredInterviewRecording } from "@/lib/deletion-storage.mjs";
import { enqueueRecordingCleanupTask } from "@/lib/recording-cleanup-queue.mjs";
import { isInterviewDeletionLocked } from "@/lib/deletion-execution-policy.mjs";

export const runtime = "nodejs";

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
  if (url.username || url.password || url.search || url.hash) throw new Error("Recording storage endpoint must not contain credentials, query parameters or a fragment.");
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

async function s3Request(method: "PUT" | "GET" | "HEAD", key: string, body?: Buffer, contentType?: string, range?: string) {
  const config = remoteStorageConfig();
  if (!config) throw new Error("Private cloud recording storage is not configured.");
  const url = s3RequestUrl(config.endpoint, config.bucket, key);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body || Buffer.alloc(0)).digest("hex");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  if (range) headers.range = range;
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
  // Storage endpoints are external dependencies: fail closed on redirects and
  // cap request time so uploads/playback cannot hold a server worker forever.
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      // Node fetch accepts Buffer as a byte body. Keep the existing Buffer
      // view instead of cloning another full-size Uint8Array for large uploads.
      body: method === "PUT" ? (body || Buffer.alloc(0)) as unknown as BodyInit : undefined,
      cache: "no-store",
      redirect: "error",
      // A 100 MiB recording can legitimately take longer than 30 seconds on
      // slower uplinks. Keep playback metadata/range requests short, but allow
      // bounded time for the upload itself to reach private object storage.
      signal: AbortSignal.timeout(method === "PUT" ? 120_000 : 30_000)
    });
  } catch {
    // Normalize DNS, TLS, timeout and connection failures so callers return a
    // retryable 502 rather than misreporting an upstream outage as app failure.
    throw new Error("Private recording storage request failed.");
  }
  if (!response.ok) throw new Error("Private recording storage returned " + response.status + ": " + (await response.text()).slice(0, 500));
  return response;
}

async function readBoundedRecordingForm(request: NextRequest, maxBytes: number): Promise<{ form: FormData } | { error: string; status: number }> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return { error: "A multipart recording upload is required.", status: 415 };
  }
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
      return { error: "Invalid recording upload length.", status: 400 };
    }
    if (declaredLength > maxBytes) {
      return { error: "Recording upload exceeds the 100 MB limit.", status: 413 };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { error: "Recording upload body is missing.", status: 400 };
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { error: "Recording upload exceeds the 100 MB limit.", status: 413 };
      }
      chunks.push(part.value);
    }
  } catch {
    return { error: "Could not read recording upload.", status: 400 };
  }

  try {
    // Parse only after the complete multipart body has passed the streaming
    // byte limit. This also safely supports runtimes that omit Content-Length.
    // Build the Blob directly from the bounded chunks instead of allocating
    // another contiguous 100 MiB Uint8Array first. Blob snapshots its parts, so
    // release the chunk references before multipart parsing continues.
    // The runtime accepts Uint8Array parts; the assertion bridges the
    // TypeScript ArrayBufferLike/BlobPart generic mismatch without copying
    // every chunk into another full-size set of ArrayBuffers.
    const body = new Blob(chunks as unknown as BlobPart[]);
    chunks.length = 0;
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body
    });
    return { form: await boundedRequest.formData() };
  } catch {
    return { error: "Invalid multipart recording upload.", status: 400 };
  }
}

function isRemoteRecordingPath(value: string) {
  return value.startsWith("s3://");
}

function recordingObjectKey(value: string) {
  const key = value.slice("s3://".length);
  if (!/^recordings\/[a-f0-9-]{36}\.(webm|mp4|mov)$/i.test(key)) throw new Error("Recording storage reference is invalid.");
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

function localRecordingPath(storedPath: string) {
  const normalized = storedPath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() || "";
  if (normalized !== "data/recordings/" + filename || !isSafeRecordingFilename(filename)) {
    throw new Error("Recording storage reference is invalid.");
  }
  return join(process.cwd(), "data", "recordings", filename);
}

async function recordingSize(storedPath: string) {
  if (isRemoteRecordingPath(storedPath)) {
    const response = await s3Request("HEAD", recordingObjectKey(storedPath));
    const size = parseRecordingContentLength(response.headers.get("content-length"));
    if (size === null) throw new Error("Recording storage returned invalid metadata.");
    return size;
  }
  const metadata = await stat(localRecordingPath(storedPath));
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) throw new Error("Recording file size is invalid.");
  return metadata.size;
}

async function deleteRecording(storedPath: string) {
  // Reuse the same path validation and idempotent deletion implementation used
  // by the privacy-deletion workflow so replacement cleanup cannot drift.
  await deleteStoredInterviewRecording(storedPath);
}

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
  // Authenticate before looking up the interview so unauthorised callers cannot
  // distinguish a missing interview from an existing one or inspect its state.
  const employer = await isEmployerAuthenticated();
  const candidateToken = getCandidateInvitationToken(request, id);
  const candidate = employer ? false : await hasValidCandidateSession(id, candidateToken);
  if (!employer && !candidate) {
    return NextResponse.json({ error: "Unauthorized recording upload." }, { status: 401, headers: privateHeaders });
  }
  try {
    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, recordingPath: true, status: true, consentAcceptedAt: true, startedAt: true, deletionInProgress: true }
    });
    if (!interview) return NextResponse.json({ error: "Interview not found." }, { status: 404, headers: privateHeaders });
    if (isInterviewDeletionLocked(interview)) {
      return NextResponse.json({ error: "Recording uploads are closed because this interview is being deleted." }, { status: 409, headers: privateHeaders });
    }
    const completedRecovery = interview.status === "completed" && !interview.recordingPath;
    if (interview.status === "completed" && !completedRecovery) {
      return NextResponse.json({ error: "A recording is already saved or uploads are closed for this interview." }, { status: 409, headers: privateHeaders });
    }
    if (!interview.consentAcceptedAt || !interview.startedAt || (interview.status !== "in_progress" && !completedRecovery)) {
      return NextResponse.json({ error: "Recording is only accepted after the candidate has consented and started the interview." }, { status: 403, headers: privateHeaders });
    }

    const parsedForm = await readBoundedRecordingForm(request, MAX_RECORDING_BYTES + 1024 * 1024);
    if ("error" in parsedForm) {
      return NextResponse.json({ error: parsedForm.error }, { status: parsedForm.status, headers: privateHeaders });
    }
    const file = parsedForm.form.get("recording");
    if (!(file instanceof File)) return NextResponse.json({ error: "Recording file is required." }, { status: 400, headers: privateHeaders });
    const mimeType = file.type.split(";")[0].trim();
    if (file.size < 1 || file.size > MAX_RECORDING_BYTES) {
      return NextResponse.json({ error: "Recording must be no larger than 100 MB." }, { status: 413, headers: privateHeaders });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const validation = inspectRecordingUpload(mimeType, file.size, bytes);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status, headers: privateHeaders });
    }
    const extension = validation.extension;

    const filename = randomUUID() + extension;
    const relativePath = await saveRecording(bytes, mimeType, filename);
    const replacement = await commitRecordingReplacement({
      commit: () => db.$transaction(async tx => {
        // Commit the new recording reference and durable cleanup intent for the
        // previous object together. A crash after this transaction cannot lose
        // the old-object cleanup request.
        const updated = await tx.interview.updateMany({
          // Permit one late recovery after completion only when no recording was
          // saved before the report closed the interview. The status/path predicate
          // prevents concurrent retries from replacing an already committed file.
          where: { id, status: interview.status, recordingPath: interview.recordingPath, deletionInProgress: false },
          data: { recordingPath: relativePath }
        });
        if (updated.count === 1 && interview.recordingPath) {
          await enqueueRecordingCleanupTask(tx, {
            storedPath: interview.recordingPath,
            reason: "recording_replaced"
          });
        }
        return updated;
      }),
      cleanupNew: () => deleteRecording(relativePath),
      cleanupNewPath: relativePath,
      enqueueCleanup: (storedPath, reason) => enqueueRecordingCleanupTask(db, {
        storedPath,
        reason,
        // If the commit outcome could not be read, give any in-flight database
        // transaction time to settle before the worker's reference check.
        now: reason.includes("new-recording-after-commit") ? new Date(Date.now() + 5 * 60 * 1000) : undefined
      }),
      // If the DB request times out after committing, a cleanup must not remove
      // the object now referenced by the interview. If this read also fails,
      // preserve the object and let later storage reconciliation handle the orphan.
      isNewRecordingReferenced: async () => Boolean(await db.interview.findFirst({
        where: { recordingPath: relativePath },
        select: { id: true }
      })),
      cleanupPrevious: path => deleteRecording(path),
      previousPath: interview.recordingPath,
      onCleanupError: (cleanupError, stage) => {
        console.error("Recording cleanup failed: " + stage, cleanupError);
      }
    });

    if (!replacement.ok) {
      return NextResponse.json({ error: "The interview changed while this recording was uploading. Please retry." }, { status: 409, headers: privateHeaders });
    }
    return NextResponse.json({ ok: true, message: "Recording saved to private storage." }, { headers: privateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const missingConfiguration = message.includes("Configure S3_ENDPOINT") || message.includes("Private cloud recording storage is not configured");
    const storageUnavailable = message.includes("Private recording storage");
    return NextResponse.json({
      error: missingConfiguration
        ? "Production recording storage is not configured. Contact the hiring team."
        : storageUnavailable
          ? "Private recording storage is temporarily unavailable. Please retry."
          : "Could not save recording on the server."
    }, { status: missingConfiguration ? 503 : storageUnavailable ? 502 : 500, headers: privateHeaders });
  }
}

export async function GET(request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" } });
  }
  const { id } = await context.params;
  const interview = await db.interview.findUnique({ where: { id }, select: { recordingPath: true } });
  if (!interview?.recordingPath) {
    return NextResponse.json({ error: "No recording is available." }, {
      status: 404,
      headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" }
    });
  }

  try {
    const storedPath = interview.recordingPath;
    const remote = isRemoteRecordingPath(storedPath);
    const filename = remote
      ? recordingObjectKey(storedPath).split("/").pop() || ""
      : storedPath.split("/").pop() || "";
    const contentType = filename.endsWith(".mp4") ? "video/mp4" : filename.endsWith(".mov") ? "video/quicktime" : "video/webm";
    const size = await recordingSize(storedPath);
    const rangeHeader = request.headers.get("range");
    const range = rangeHeader ? parseByteRange(rangeHeader, size) : null;
    const baseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Disposition": "inline; filename=\"" + filename + "\"",
      "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff"
    };

    if (range && !range.ok) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": "bytes */" + size, "Content-Length": "0" }
      });
    }

    if (size === 0) {
      return new NextResponse(null, { status: 200, headers: { ...baseHeaders, "Content-Length": "0" } });
    }

    const start = range?.ok ? range.start : 0;
    const end = range?.ok ? range.end : size - 1;
    const length = range?.ok ? range.length : size;
    const status = range?.ok ? 206 : 200;
    if (range?.ok) baseHeaders["Content-Range"] = "bytes " + start + "-" + end + "/" + size;
    baseHeaders["Content-Length"] = String(length);

    if (remote) {
      const response = await s3Request("GET", recordingObjectKey(storedPath), undefined, undefined, range?.ok ? rangeHeader || undefined : undefined);
      const expectedContentRange = range?.ok ? "bytes " + start + "-" + end + "/" + size : null;
      if (!isExpectedRecordingStorageResponse({
        status: response.status,
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
        expectedStatus: status,
        expectedLength: length,
        expectedContentRange
      })) {
        throw new Error("Recording storage returned inconsistent playback metadata.");
      }
      return new NextResponse(response.body, { status, headers: baseHeaders });
    }

    const stream = createReadStream(localRecordingPath(storedPath), { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, { status, headers: baseHeaders });
  } catch (error) {
    const remote = isRemoteRecordingPath(interview.recordingPath);
    return NextResponse.json({
      error: remote
        ? "Private recording storage is temporarily unavailable."
        : "Recording file is missing from server storage."
    }, { status: remote ? 502 : 404, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" } });
  }
}

export async function HEAD(_request: NextRequest, context: Context) {
  if (!(await isEmployerAuthenticated())) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" } });
  const { id } = await context.params;
  const interview = await db.interview.findUnique({ where: { id }, select: { recordingPath: true } });
  if (!interview?.recordingPath) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" } });
  try {
    const storedPath = interview.recordingPath;
    const filename = isRemoteRecordingPath(storedPath)
      ? recordingObjectKey(storedPath).split("/").pop() || ""
      : storedPath.split("/").pop() || "";
    const size = await recordingSize(storedPath);
    const contentType = filename.endsWith(".mp4") ? "video/mp4" : filename.endsWith(".mov") ? "video/quicktime" : "video/webm";
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Content-Disposition": "inline; filename=\"" + filename + "\"",
        "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return new NextResponse(null, { status: isRemoteRecordingPath(interview.recordingPath) ? 502 : 404, headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" } });
  }
}
