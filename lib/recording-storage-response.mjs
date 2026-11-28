export function parseRecordingContentLength(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

export function isExpectedRecordingStorageResponse({
  status,
  contentLength,
  contentRange,
  expectedStatus,
  expectedLength,
  expectedContentRange = null
}) {
  if (status !== expectedStatus) return false;
  if (parseRecordingContentLength(contentLength) !== expectedLength) return false;
  if (expectedContentRange === null) return contentRange === null;
  return contentRange === expectedContentRange;
}
