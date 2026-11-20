const QUESTION_STATUSES = ["Correct", "Partially correct", "Incorrect", "Unanswered"];

/**
 * Read a leading assessment label without guessing when the report does not
 * follow the expected format. The original assessment remains available.
 */
export function parseQuestionAssessment(assessment) {
  if (typeof assessment !== "string" || !assessment.trim()) {
    return { status: "Unclassified", detail: typeof assessment === "string" ? assessment : "" };
  }
  const value = assessment.trim();
  const match = value.match(/^(Correct|Partially correct|Incorrect|Unanswered)\\s*(?::|—|–|-)?\\s*/i);
  if (!match) return { status: "Unclassified", detail: value };
  const status = QUESTION_STATUSES.find(item => item.toLocaleLowerCase() === match[1].toLocaleLowerCase()) || "Unclassified";
  return { status, detail: value.slice(match[0].length).trim() };
}

/** Counts only explicit, recognized assessment labels. */
export function summarizeQuestionAssessments(questionFeedback) {
  const summary = {
    total: Array.isArray(questionFeedback) ? questionFeedback.length : 0,
    Correct: 0,
    "Partially correct": 0,
    Incorrect: 0,
    Unanswered: 0,
    Unclassified: 0
  };
  for (const item of Array.isArray(questionFeedback) ? questionFeedback : []) {
    const { status } = parseQuestionAssessment(item?.assessment);
    summary[status] += 1;
  }
  return summary;
}
