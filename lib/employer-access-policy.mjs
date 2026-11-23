export const EMPLOYER_ROLES = Object.freeze(["owner", "admin", "recruiter", "reviewer"]);

export const EMPLOYER_PERMISSIONS = Object.freeze([
  "interview:create",
  "interview:read",
  "interview:decision",
  "interview:export",
  "audit:read",
  "organization:manage_members",
  "privacy:manage_requests",
  "privacy:approve_deletion",
  "privacy:execute_deletion"
]);

const ROLE_PERMISSIONS = Object.freeze({
  owner: EMPLOYER_PERMISSIONS,
  admin: EMPLOYER_PERMISSIONS,
  recruiter: Object.freeze([
    "interview:create",
    "interview:read",
    "interview:decision",
    "interview:export",
    "audit:read"
  ]),
  reviewer: Object.freeze([
    "interview:read",
    "audit:read"
  ])
});

export function normalizeEmployerRole(role) {
  if (typeof role !== "string") return null;
  const normalized = role.trim().toLowerCase();
  return EMPLOYER_ROLES.includes(normalized) ? normalized : null;
}

export function hasEmployerPermission(role, permission) {
  const normalizedRole = normalizeEmployerRole(role);
  if (!normalizedRole || typeof permission !== "string") return false;
  return ROLE_PERMISSIONS[normalizedRole].includes(permission);
}

export function resolveEmployerMembershipAccess(memberships, permission) {
  if (!Array.isArray(memberships) || memberships.length !== 1) return null;
  const membership = memberships[0];
  if (!membership || typeof membership.organizationId !== "string" || !membership.organizationId.trim()) return null;
  if (!hasEmployerPermission(membership.role, permission)) return null;
  return { organizationId: membership.organizationId.trim(), role: normalizeEmployerRole(membership.role) };
}
