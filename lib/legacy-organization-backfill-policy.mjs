const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveLegacyOrganizationPlan({
  organizationCount,
  existingOrganization,
  unassignedInterviewCount,
  name,
  slug
}) {
  if (!Number.isInteger(organizationCount) || organizationCount < 0) {
    return { ok: false, reason: "invalid_organization_count" };
  }
  if (!Number.isInteger(unassignedInterviewCount) || unassignedInterviewCount < 0) {
    return { ok: false, reason: "invalid_unassigned_interview_count" };
  }
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    return { ok: false, reason: "invalid_organization_name" };
  }
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: "invalid_organization_slug" };
  }
  if (organizationCount > 1) {
    return { ok: false, reason: "multiple_organizations_require_manual_review" };
  }
  if (organizationCount === 0) {
    if (existingOrganization !== null && existingOrganization !== undefined) {
      return { ok: false, reason: "unexpected_existing_organization" };
    }
    return {
      ok: true,
      action: "create",
      organizationName: name.trim(),
      organizationSlug: slug,
      unassignedInterviewCount
    };
  }
  if (!existingOrganization || existingOrganization.slug !== slug) {
    return { ok: false, reason: "existing_organization_does_not_match_legacy_slug" };
  }
  return {
    ok: true,
    action: "reuse",
    organizationId: existingOrganization.id,
    organizationName: existingOrganization.name,
    organizationSlug: existingOrganization.slug,
    unassignedInterviewCount
  };
}
