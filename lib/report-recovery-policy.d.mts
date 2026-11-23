export type RestorableInterviewReport = {
  overallScore: number;
  recommendation: "Strong match" | "Consider" | "Needs review";
  summary: string;
  disclaimer: string;
  strengths: string[];
  improvementAreas: string[];
  skills: Array<{ skill: string; rating: "Strong" | "Good" | "Developing" | "Insufficient evidence"; evidence: string }>;
  questionFeedback: Array<{ question: string; assessment: string; evidence: string }>;
};

export function isRestorableInterviewReport(value: unknown): value is RestorableInterviewReport;
