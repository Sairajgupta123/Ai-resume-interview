export type ByteRangeResult = { ok: true; start: number; end: number; length: number } | { ok: false; status: 416 };
export function parseByteRange(header: string, size: number): ByteRangeResult;
