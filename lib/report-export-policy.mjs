function boundedText(value, maxLength = 4_000) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return String(value).slice(0, maxLength);
}

function recordList(value, fields, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, limit)
    .map(item => Object.fromEntries(fields.map(field => [field, boundedText(item[field])])));
}

function textList(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === "string" && item.trim())
    .slice(0, limit)
    .map(item => boundedText(item));
}

export function normalizeReportForExport(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
  const report = parsed;
  return {
    summary: boundedText(report.summary, 12_000),
    skills: recordList(report.skills, ["skill", "rating", "evidence"]),
    questionFeedback: recordList(report.questionFeedback, ["question", "assessment", "evidence"]),
    strengths: textList(report.strengths),
    improvementAreas: textList(report.improvementAreas)
  };
}

export function safeCsvCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = typeof value !== "number" && /^[\s\u0000-\u001f]*[-=+@]/u.test(raw)
    ? "'" + raw
    : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
