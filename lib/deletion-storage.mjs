import { createHash, createHmac } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { isSupportedDeletionRecordingPath } from "./deletion-execution-policy.mjs";

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function remoteConfig() {
  const endpoint = process.env.S3_ENDPOINT?.replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || "auto";
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) throw new Error("STORAGE_NOT_CONFIGURED");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("STORAGE_INSECURE_ENDPOINT");
  return { endpoint: url, bucket, region, accessKey, secretKey };
}

function remoteObjectUrl(storedPath) {
  const config = remoteConfig();
  const key = storedPath.slice("s3://".length);
  const url = new URL(config.endpoint.toString());
  const prefix = url.pathname.replace(/\/+$/, "");
  url.pathname = prefix + "/" + encodeURIComponent(config.bucket) + "/" + key.split("/").map(encodeURIComponent).join("/");
  return { config, url };
}

async function deleteRemoteRecording(storedPath) {
  const { config, url } = remoteObjectUrl(storedPath);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(name => name + ":" + headers[name] + "\n").join("");
  const canonicalRequest = ["DELETE", url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = dateStamp + "/" + config.region + "/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const dateKey = hmac("AWS4" + config.secretKey, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  headers.authorization = "AWS4-HMAC-SHA256 Credential=" + config.accessKey + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  // Bound remote deletion time so a stalled storage request cannot hold an
  // execution lease indefinitely. Never follow redirects with a signed request.
  const response = await fetch(url, {
    method: "DELETE",
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  if (response.ok || response.status === 404) return;
  throw new Error("REMOTE_RECORDING_DELETE_FAILED");
}

export async function deleteStoredInterviewRecording(storedPath) {
  if (!storedPath) return;
  if (!isSupportedDeletionRecordingPath(storedPath)) throw new Error("UNSUPPORTED_RECORDING_REFERENCE");
  if (storedPath.startsWith("s3://")) {
    await deleteRemoteRecording(storedPath);
    return;
  }
  const filename = storedPath.slice("data/recordings/".length);
  const filePath = join(process.cwd(), "data", "recordings", filename);
  try {
    await unlink(filePath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw new Error("LOCAL_RECORDING_DELETE_FAILED");
  }
}
