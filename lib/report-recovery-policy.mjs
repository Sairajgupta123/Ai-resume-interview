import { calculateEvidenceCoverage, deriveRecommendation } from "./evaluation-policy.mjs";

const RATINGS = new Set(["Strong", "Good", "Developing", "Insufficient evidence"]);
const RECOMMENDATIONS = new Set(["Strong match", "Consider", "Needs review"]);

function boundedString(value, maxLength, allowEmpty = false) {
  return typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0);
}

export function isRestorableInterviewReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value;
  if (!Number.isInteger(report.overallScore) || report.overallScore < 0 || report.overallScore > 100) return false;
  if (!RECOMMENDATIONS.has(report.recommendation)) return false;
  if (!boundedString(report.summary, 3000)) return false;
  if (!boundedString(report.disclaimer, 1000)) return false;
  if (!Array.isArray(report.strengths) || report.strengths.length > 12 ||
      !report.strengths.every(item => boundedString(item, 500))) return false;
  if (!Array.isArray(report.improvementAreas) || report.improvementAreas.length > 12 ||
      !report.improvementAreas.every(item => boundedString(item, 500))) return false;
  if (!Array.isArray(report.skills) || report.skills.length > 30) return false;
  if (!report.skills.every(item =>
    item && typeof item === "object" && !Array.isArray(item) &&
    boundedString(item.skill, 120) && RATINGS.has(item.rating) &&
    boundedString(item.evidence, 1200) &&
    (item.rating === "Insufficient evidence"
      ? item.evidence === "Insufficient evidence"
      : item.evidence !== "Insufficient evidence" && item.evidence.trim().length >= 8)
  )) return false;
  if (!Array.isArray(report.questionFeedback) || report.questionFeedback.length > 40) return false;
  if (!report.questionFeedback.every(item =>
    item && typeof item === "object" && !Array.isArray(item) &&
    boundedString(item.question, 1000) &&
    boundedString(item.assessment, 1500) &&
    boundedString(item.evidence, 1200) &&
    (item.evidence === "Insufficient evidence" || item.evidence.trim().length >= 8)
  )) return false;
  // Keep recovery validation identical to initial report generation:
  // only assessed-skill evidence contributes to the recommendation.
  const evidenceCoverage = calculateEvidenceCoverage(report.skills);
  const expectedRecommendation = deriveRecommendation(report.overallScore, evidenceCoverage);
  if (report.recommendation !== expectedRecommendation) return false;
  return true;
}
