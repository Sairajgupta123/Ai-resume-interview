export type QuestionAssessmentStatus = "Correct" | "Partially correct" | "Incorrect" | "Unanswered" | "Unclassified";
export function parseQuestionAssessment(assessment: unknown): { status: QuestionAssessmentStatus; detail: string };
export function summarizeQuestionAssessments(questionFeedback: unknown[]): {
  total: number;
  Correct: number;
  "Partially correct": number;
  Incorrect: number;
  Unanswered: number;
  Unclassified: number;
};
