export type InterviewOrganizationWhere = {
  organizationId: string;
  id?: string;
};
export function buildInterviewOrganizationWhere(
  organizationId: unknown,
  interviewId?: unknown
): InterviewOrganizationWhere | null;
export function buildInterviewRelationOrganizationWhere(
  organizationId: unknown
): { interview: { organizationId: string } } | null;
