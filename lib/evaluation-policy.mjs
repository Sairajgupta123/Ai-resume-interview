export function normalizeSkillName(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/\s+/g, " ") : "";
}

export function hasDuplicateSkills(skills) {
  if (!Array.isArray(skills)) return true;
  const names = skills.map(item => normalizeSkillName(item?.skill));
  return names.some(name => !name) || new Set(names).size !== names.length;
}

export function isRatingEvidenceConsistent(rating, evidence) {
  if (rating === "Insufficient evidence") return evidence === "Insufficient evidence";
  return typeof evidence === "string" && evidence !== "Insufficient evidence" && evidence.trim().length >= 8;
}

export function calculateEvidenceCoverage(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const supported = items.filter(item =>
    typeof item?.evidence === "string" &&
    item.evidence !== "Insufficient evidence" &&
    item.evidence.trim().length >= 8
  ).length;
  return Math.round((supported / items.length) * 100);
}

export function deriveRecommendation(score, evidenceCoveragePercent) {
  if (!Number.isInteger(score) || score < 0 || score > 100) return "Needs review";
  if (!Number.isFinite(evidenceCoveragePercent) || evidenceCoveragePercent < 50) return "Needs review";
  if (score >= 80 && evidenceCoveragePercent >= 75) return "Strong match";
  if (score >= 60) return "Consider";
  return "Needs review";
}


export function hasRequiredSkillCoverage(skills, requiredSkills) {
  if (!Array.isArray(skills) || !Array.isArray(requiredSkills)) return false;
  const assessed = new Set(skills.map(item => normalizeSkillName(item?.skill)).filter(Boolean));
  return requiredSkills.every(skill => {
    const normalized = normalizeSkillName(skill);
    return normalized.length > 0 && assessed.has(normalized);
  });
}
