export type ReportExportSkill = {
  skill: string;
  rating: string;
  evidence: string;
};

export type ReportExportQuestion = {
  question: string;
  assessment: string;
  evidence: string;
};

export type NormalizedReportForExport = {
  summary: string;
  skills: ReportExportSkill[];
  questionFeedback: ReportExportQuestion[];
  strengths: string[];
  improvementAreas: string[];
};

export function normalizeReportForExport(value: unknown): NormalizedReportForExport;
