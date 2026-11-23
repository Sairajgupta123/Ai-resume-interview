export const EMPLOYER_ROLES: readonly ["owner", "admin", "recruiter", "reviewer"];
export const EMPLOYER_PERMISSIONS: readonly [
  "interview:create",
  "interview:read",
  "interview:decision",
  "interview:export",
  "audit:read",
  "organization:manage_members",
  "privacy:approve_deletion",
  "privacy:execute_deletion"
];
export type EmployerRole = "owner" | "admin" | "recruiter" | "reviewer";
export type EmployerPermission =
  | "interview:create"
  | "interview:read"
  | "interview:decision"
  | "interview:export"
  | "audit:read"
  | "organization:manage_members"
  | "privacy:approve_deletion"
  | "privacy:execute_deletion";
export function normalizeEmployerRole(role: unknown): EmployerRole | null;
export function hasEmployerPermission(role: unknown, permission: unknown): boolean;
