export function inspectCachedRecordingRows(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Saved recording metadata is invalid.");
  }
  if (rows.length === 0) return null;

  const metadataRows = rows.filter(row => row && row.recordType === "metadata");
  if (metadataRows.length > 1) {
    throw new Error("Saved recording metadata is inconsistent.");
  }
  const metadata = metadataRows[0];
  const chunks = rows
    .filter(row => !row || row.recordType !== "metadata")
    .sort((a, b) => (a?.index ?? Number.MAX_SAFE_INTEGER) - (b?.index ?? Number.MAX_SAFE_INTEGER));

  const hasGapOrInvalidChunk = chunks.some((row, index) =>
    !row ||
    !Number.isSafeInteger(row.index) ||
    row.index !== index ||
    !(row.blob instanceof Blob) ||
    row.blob.size < 1 ||
    typeof row.mimeType !== "string" ||
    !row.mimeType.trim()
  );
  const mimeType = metadata?.mimeType || chunks[0]?.mimeType || "video/webm";
  const hasMixedTypes = chunks.some(row =>
    !row || typeof row !== "object" || (row.mimeType || "video/webm") !== mimeType
  );
  if (hasGapOrInvalidChunk || hasMixedTypes || chunks.length === 0) {
    throw new Error("Saved recording segments are incomplete or inconsistent. The video cannot be safely recovered.");
  }

  return {
    chunks: chunks.map(row => row.blob),
    mimeType,
    complete: metadata?.status === "complete"
  };
}
