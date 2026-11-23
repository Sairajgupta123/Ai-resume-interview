export type LegacyOrganizationPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      action: "create";
      organizationName: string;
      organizationSlug: string;
      unassignedInterviewCount: number;
    }
  | {
      ok: true;
      action: "reuse";
      organizationId: string;
      organizationName: string;
      organizationSlug: string;
      unassignedInterviewCount: number;
    };

export function resolveLegacyOrganizationPlan(input: {
  organizationCount: number;
  existingOrganization?: { id: string; name: string; slug: string } | null;
  unassignedInterviewCount: number;
  name: unknown;
  slug: unknown;
}): LegacyOrganizationPlan;
