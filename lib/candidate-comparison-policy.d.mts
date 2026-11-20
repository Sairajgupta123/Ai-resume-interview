export type ComparisonRating = "Strong" | "Good" | "Developing" | "Insufficient evidence";
export type CandidateForComparison = {
  id: string;
  candidateName: string;
  role: string;
  overallScore: number | null;
  recommendation: string | null;
  reportJson: string | null;
};
export type CandidateComparison = {
  sameRole: boolean;
  comparisonNote: string;
  candidates: Array<{ id: string; candidateName: string; role: string; overallScore: number | null; recommendation: string; evidenceSkillCount: number; reportedSkillCount: number }>;
  skills: Array<{ skill: string; candidates: Array<{ candidateId: string; rating: ComparisonRating; evidence: string }> }>;
};
export function buildCandidateComparison(candidates: CandidateForComparison[]): CandidateComparison;
