export function parseByteRange(header, size) {
  if (typeof header !== "string" || !Number.isSafeInteger(size) || size < 0) {
    return { ok: false, status: 416 };
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size === 0) return { ok: false, status: 416 };
  const [, startText, endText] = match;

  if (!startText && !endText) return { ok: false, status: 416 };

  let start;
  let end;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { ok: false, status: 416 };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      return { ok: false, status: 416 };
    }
    end = Math.min(end, size - 1);
  }

  return { ok: true, start, end, length: end - start + 1 };
}

/**
 * Verify that private object storage honored the exact byte range requested.
 * A malformed upstream response must never be forwarded with locally-authored
 * Content-Range / Content-Length headers.
 */
export function validateRecordingStorageResponse(response, expected) {
  if (!response || !expected || !Number.isSafeInteger(expected.size) || expected.size < 0) return false;
  if (typeof response.contentLength !== "string" || !/^(0|[1-9]\d*)$/.test(response.contentLength)) return false;
  const contentLength = Number(response.contentLength);
  if (!Number.isSafeInteger(contentLength)) return false;

  if (expected.partial) {
    if (!Number.isSafeInteger(expected.start) || !Number.isSafeInteger(expected.end)
      || expected.start < 0 || expected.end < expected.start || expected.end >= expected.size) return false;
    const length = expected.end - expected.start + 1;
    return Number.isSafeInteger(length)
      && response.status === 206
      && response.contentRange === `bytes ${expected.start}-${expected.end}/${expected.size}`
      && contentLength === length;
  }

  return response.status === 200
    && response.contentRange == null
    && contentLength === expected.size;
}
