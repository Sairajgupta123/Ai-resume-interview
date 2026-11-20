import { matchesSkillTerm } from "./skill-coverage-policy.mjs";

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

export function deriveRecommendation(score, evidenceCoveragePercent, skillEvidenceCoveragePercent = evidenceCoveragePercent) {
  if (!Number.isInteger(score) || score < 0 || score > 100) return "Needs review";
  if (!Number.isFinite(evidenceCoveragePercent) || evidenceCoveragePercent < 50) return "Needs review";
  if (!Number.isFinite(skillEvidenceCoveragePercent) || skillEvidenceCoveragePercent < 50) return "Needs review";
  if (score >= 80 && evidenceCoveragePercent >= 75 && skillEvidenceCoveragePercent >= 75) return "Strong match";
  if (score >= 60) return "Consider";
  return "Needs review";
}

/**
 * Ensure every extracted job-description skill appears in the report.
 * Missing skills are explicitly marked unsupported; the helper never assigns
 * a positive rating or fabricates candidate evidence.
 */
export function completeRequiredSkillEvaluations(requiredSkills, evaluatedSkills) {
  const result = Array.isArray(evaluatedSkills) ? evaluatedSkills.map(item => ({ ...item })) : [];
  const required = Array.isArray(requiredSkills) ? requiredSkills.slice(0, 15) : [];
  for (const skill of required) {
    if (typeof skill !== "string" || !skill.trim()) continue;
    const alreadyEvaluated = result.some(item =>
      item && typeof item.skill === "string" && matchesSkillTerm(item.skill, skill)
    );
    if (!alreadyEvaluated) {
      result.push({
        skill,
        rating: "Insufficient evidence",
        evidence: "Insufficient evidence"
      });
    }
  }
  return result;
}

/**
 * A skill quote is supported only when it appears in the answer to an
 * interviewer question explicitly mapped to that same required skill.
 * This prevents evidence from an unrelated answer being reused.
 */
export function isSkillEvidenceLinkedToQuestion(skill, evidence, questionFeedback) {
  if (evidence === "Insufficient evidence") return false;
  if (typeof skill !== "string" || typeof evidence !== "string" || !Array.isArray(questionFeedback)) return false;
  const normalize = value => value.toLocaleLowerCase().trim().replace(/\\s+/g, " ");
  const quote = normalize(evidence);
  return questionFeedback.some(item => {
    if (!item || !Array.isArray(item.testedSkills) || typeof item.pairedAnswer !== "string") return false;
    const testsSkill = item.testedSkills.some(tested =>
      typeof tested === "string" && (matchesSkillTerm(tested, skill) || matchesSkillTerm(skill, tested))
    );
    return testsSkill && normalize(item.pairedAnswer).includes(quote);
  });
}
