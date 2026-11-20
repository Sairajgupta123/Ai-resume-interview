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
