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
