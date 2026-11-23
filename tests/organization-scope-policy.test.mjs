import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInterviewOrganizationWhere,
  buildInterviewRelationOrganizationWhere
} from "../lib/organization-scope-policy.mjs";

test("organization list scope always includes the organization id", () => {
  assert.deepEqual(buildInterviewOrganizationWhere("org-a"), { organizationId: "org-a" });
});

test("interview detail scope combines interview id with organization id", () => {
  assert.deepEqual(buildInterviewOrganizationWhere("org-a", "interview-1"), {
    organizationId: "org-a",
    id: "interview-1"
  });
});

test("invalid organization identity fails closed instead of returning an empty where clause", () => {
  for (const value of [null, undefined, "", "   ", 42]) {
    assert.equal(buildInterviewOrganizationWhere(value), null);
    assert.equal(buildInterviewRelationOrganizationWhere(value), null);
  }
});

test("invalid interview ids fail closed", () => {
  for (const value of [null, undefined, "", "   ", 42]) {
    assert.equal(buildInterviewOrganizationWhere("org-a", value), null);
  }
});

test("related audit queries are scoped through the owning interview", () => {
  assert.deepEqual(buildInterviewRelationOrganizationWhere(" org-b "), {
    interview: { organizationId: "org-b" }
  });
});


test("cross-organization list scopes are mutually exclusive", () => {
  const organizationA = buildInterviewOrganizationWhere("org-a");
  const organizationB = buildInterviewOrganizationWhere("org-b");
  assert.deepEqual(organizationA, { organizationId: "org-a" });
  assert.deepEqual(organizationB, { organizationId: "org-b" });
  assert.notDeepEqual(organizationA, organizationB);
  assert.equal(organizationA.organizationId === "org-b", false);
  assert.equal(organizationB.organizationId === "org-a", false);
});

test("cross-organization detail access requires both the requested interview id and owning organization", () => {
  const requestedInterview = "interview-owned-by-org-b";
  const organizationAWhere = buildInterviewOrganizationWhere("org-a", requestedInterview);
  const organizationBWhere = buildInterviewOrganizationWhere("org-b", requestedInterview);
  assert.deepEqual(organizationAWhere, {
    organizationId: "org-a",
    id: requestedInterview
  });
  assert.deepEqual(organizationBWhere, {
    organizationId: "org-b",
    id: requestedInterview
  });
  assert.notDeepEqual(organizationAWhere, organizationBWhere);
});

test("cross-organization related records cannot use an unscoped relation filter", () => {
  const organizationAWhere = buildInterviewRelationOrganizationWhere("org-a");
  const organizationBWhere = buildInterviewRelationOrganizationWhere("org-b");
  assert.deepEqual(organizationAWhere, { interview: { organizationId: "org-a" } });
  assert.deepEqual(organizationBWhere, { interview: { organizationId: "org-b" } });
  assert.notDeepEqual(organizationAWhere, organizationBWhere);
});
