export function escapeCsvValue(value) {
  const raw = String(value ?? "");
  const safe = typeof value === "string" && /^[\\t\\r\\n ]*[-=+@]/.test(raw)
    ? "'" + raw
    : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function buildCsv(columns, rows) {
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    throw new TypeError("CSV columns and rows must be arrays.");
  }
  const width = columns.length;
  if (rows.some(row => !Array.isArray(row) || row.length !== width)) {
    throw new RangeError("Every CSV row must match the header column count.");
  }
  const lines = [columns, ...rows].map(row => row.map(escapeCsvValue).join(","));
  return "\\uFEFF" + lines.join("\\r\\n");
}
