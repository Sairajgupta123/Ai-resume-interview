import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteStoredInterviewRecording } from "@/lib/deletion-storage.mjs";
import { processRecordingCleanupBatch } from "@/lib/recording-cleanup-worker.mjs";
import { isAuthorizedRecordingCleanupRequest } from "@/lib/recording-cleanup-auth.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedRecordingCleanupRequest(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await processRecordingCleanupBatch({
      db,
      deleteRecording: deleteStoredInterviewRecording
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Recording cleanup worker is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" }
    });
  }
}
