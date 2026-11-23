export type ByteRangeResult = { ok: true; start: number; end: number; length: number } | { ok: false; status: 416 };
export function parseByteRange(header: string, size: number): ByteRangeResult;

export type RecordingStorageResponse = {
  status: number;
  contentRange: string | null;
  contentLength: string | null;
};

export type ExpectedRecordingStorageResponse = {
  size: number;
  partial: boolean;
  start: number;
  end: number;
};

export function validateRecordingStorageResponse(
  response: RecordingStorageResponse,
  expected: ExpectedRecordingStorageResponse
): boolean;
