export function parseRecordingContentLength(value: string | null): number | null;
export function isExpectedRecordingStorageResponse(input: {
  status: number;
  contentLength: string | null;
  contentRange: string | null;
  expectedStatus: number;
  expectedLength: number;
  expectedContentRange?: string | null;
}): boolean;
