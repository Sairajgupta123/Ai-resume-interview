import test from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyOrganizationPlan } from "../lib/legacy-organization-backfill-policy.mjs";

const defaults = {
  organizationCount: 0,
  existingOrganization: null,
  unassignedInterviewCount: 12,
  name: "Legacy MZOBS",
  slug: "legacy-mzobs"
};

test("plans creation of one explicit legacy organization when none exists", () => {
  assert.deepEqual(resolveLegacyOrganizationPlan(defaults), {
    ok: true,
    action: "create",
    organizationName: "Legacy MZOBS",
    organizationSlug: "legacy-mzobs",
    unassignedInterviewCount: 12
  });
});

test("reuses the explicitly matching legacy organization on repeat runs", () => {
  assert.deepEqual(resolveLegacyOrganizationPlan({
    ...defaults,
    organizationCount: 1,
    existingOrganization: { id: "org-1", name: "Legacy MZOBS", slug: "legacy-mzobs" }
  }), {
    ok: true,
    action: "reuse",
    organizationId: "org-1",
    organizationName: "Legacy MZOBS",
    organizationSlug: "legacy-mzobs",
    unassignedInterviewCount: 12
  });
});

test("refuses ambiguous databases with multiple organizations", () => {
  assert.deepEqual(resolveLegacyOrganizationPlan({ ...defaults, organizationCount: 2 }), {
    ok: false,
    reason: "multiple_organizations_require_manual_review"
  });
});

test("refuses to reuse an organization with a different slug", () => {
  assert.deepEqual(resolveLegacyOrganizationPlan({
    ...defaults,
    organizationCount: 1,
    existingOrganization: { id: "org-1", name: "Another Company", slug: "another-company" }
  }), {
    ok: false,
    reason: "existing_organization_does_not_match_legacy_slug"
  });
});

test("rejects malformed organization configuration and counts", () => {
  for (const input of [
    { ...defaults, name: " " },
    { ...defaults, name: "x".repeat(121) },
    { ...defaults, slug: "Legacy MZOBS" },
    { ...defaults, slug: "../legacy" },
    { ...defaults, organizationCount: -1 },
    { ...defaults, unassignedInterviewCount: -1 },
    { ...defaults, organizationCount: 1, existingOrganization: null }
  ]) assert.equal(resolveLegacyOrganizationPlan(input).ok, false);
});

test("preserves a zero-unassigned-row plan without inventing candidate assignments", () => {
  assert.equal(resolveLegacyOrganizationPlan({
    ...defaults,
    unassignedInterviewCount: 0
  }).unassignedInterviewCount, 0);
});
