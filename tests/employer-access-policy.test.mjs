import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPLOYER_PERMISSIONS,
  EMPLOYER_ROLES,
  hasEmployerPermission,
  normalizeEmployerRole
} from "../lib/employer-access-policy.mjs";

test("only the four explicitly supported employer roles are recognized", () => {
  assert.deepEqual(EMPLOYER_ROLES, ["owner", "admin", "recruiter", "reviewer"]);
  for (const role of EMPLOYER_ROLES) assert.equal(normalizeEmployerRole(role), role);
  for (const role of [null, undefined, "", "superuser", "candidate", 7]) {
    assert.equal(normalizeEmployerRole(role), null);
  }
});

test("role normalization trims whitespace and ignores case", () => {
  assert.equal(normalizeEmployerRole("  Recruiter "), "recruiter");
});

test("owners and admins receive every explicitly declared permission", () => {
  for (const role of ["owner", "admin"]) {
    for (const permission of EMPLOYER_PERMISSIONS) {
      assert.equal(hasEmployerPermission(role, permission), true, role + ":" + permission);
    }
  }
});

test("recruiters can manage interview workflow but cannot administer membership or privacy deletion", () => {
  for (const permission of ["interview:create", "interview:read", "interview:decision", "interview:export", "audit:read"]) {
    assert.equal(hasEmployerPermission("recruiter", permission), true);
  }
  for (const permission of ["organization:manage_members", "privacy:approve_deletion", "privacy:execute_deletion"]) {
    assert.equal(hasEmployerPermission("recruiter", permission), false);
  }
});

test("reviewers are read-only and cannot create, decide, export, or execute privacy actions", () => {
  assert.equal(hasEmployerPermission("reviewer", "interview:read"), true);
  assert.equal(hasEmployerPermission("reviewer", "audit:read"), true);
  for (const permission of ["interview:create", "interview:decision", "interview:export", "organization:manage_members", "privacy:approve_deletion", "privacy:execute_deletion"]) {
    assert.equal(hasEmployerPermission("reviewer", permission), false);
  }
});

test("unknown roles and permissions deny access by default", () => {
  assert.equal(hasEmployerPermission("unknown", "interview:read"), false);
  assert.equal(hasEmployerPermission(null, "interview:read"), false);
  assert.equal(hasEmployerPermission("owner", "system:root"), false);
  assert.equal(hasEmployerPermission("admin", null), false);
});

import { resolveEmployerMembershipAccess } from "../lib/employer-access-policy.mjs";

test("organization access resolves only one membership with the requested permission", () => {
  assert.deepEqual(
    resolveEmployerMembershipAccess([{ organizationId: "org-a", role: "recruiter" }], "interview:create"),
    { organizationId: "org-a", role: "recruiter" }
  );
  assert.equal(resolveEmployerMembershipAccess([{ organizationId: "org-a", role: "reviewer" }], "interview:create"), null);
});

test("organization access fails closed for zero, multiple, or malformed memberships", () => {
  assert.equal(resolveEmployerMembershipAccess([], "interview:read"), null);
  assert.equal(resolveEmployerMembershipAccess([
    { organizationId: "org-a", role: "owner" },
    { organizationId: "org-b", role: "owner" }
  ], "interview:read"), null);
  assert.equal(resolveEmployerMembershipAccess([{ organizationId: " ", role: "owner" }], "interview:read"), null);
  assert.equal(resolveEmployerMembershipAccess(null, "interview:read"), null);
});
