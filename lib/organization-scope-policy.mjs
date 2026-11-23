// Query-scope builders deliberately fail closed: missing organization identity
// must never produce an unscoped Prisma where clause.
export function buildInterviewOrganizationWhere(organizationId, interviewId) {
  if (typeof organizationId !== "string" || !organizationId.trim()) return null;
  if (interviewId !== undefined && (typeof interviewId !== "string" || !interviewId.trim())) return null;
  return {
    organizationId: organizationId.trim(),
    ...(interviewId === undefined ? {} : { id: interviewId.trim() })
  };
}

export function buildInterviewRelationOrganizationWhere(organizationId) {
  if (typeof organizationId !== "string" || !organizationId.trim()) return null;
  return { interview: { organizationId: organizationId.trim() } };
}
