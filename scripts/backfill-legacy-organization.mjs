import { PrismaClient } from "@prisma/client";
import { resolveLegacyOrganizationPlan } from "../lib/legacy-organization-backfill-policy.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const unknown = args.filter((arg) => arg !== "--apply" && arg !== "--help");
if (unknown.length || args.includes("--help")) {
  console.log("Usage: npm run db:backfill-legacy-organization [-- --apply]");
  console.log("Default is a read-only dry run. --apply performs the database transaction.");
  if (unknown.length) process.exitCode = 1;
  process.exit();
}

const name = process.env.LEGACY_ORGANIZATION_NAME;
const slug = process.env.LEGACY_ORGANIZATION_SLUG;
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured before running the backfill.");
}
if (!name || !slug) {
  throw new Error("Set LEGACY_ORGANIZATION_NAME and LEGACY_ORGANIZATION_SLUG explicitly; no organization name or slug is inferred.");
}

const prisma = new PrismaClient();

try {
  const inspect = async (db) => {
    const organizations = await db.employerOrganization.findMany({
      take: 2,
      select: { id: true, name: true, slug: true }
    });
    const unassignedInterviewCount = await db.interview.count({
      where: { organizationId: null }
    });
    const plan = resolveLegacyOrganizationPlan({
      organizationCount: organizations.length,
      existingOrganization: organizations.length === 1 ? organizations[0] : null,
      unassignedInterviewCount,
      name,
      slug
    });
    if (!plan.ok) {
      throw new Error(`Backfill refused: ${plan.reason}. Review the database manually; no rows were changed.`);
    }
    return { plan, unassignedInterviewCount };
  };

  if (!apply) {
    const { plan } = await inspect(prisma);
    console.log(JSON.stringify({
      mode: "dry-run",
      action: plan.action,
      organizationName: plan.organizationName,
      organizationSlug: plan.organizationSlug,
      unassignedInterviewCount: plan.unassignedInterviewCount,
      note: "No database rows were changed. Back up the database before applying."
    }, null, 2));
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const { plan } = await inspect(tx);
      const organization = plan.action === "create"
        ? await tx.employerOrganization.create({
            data: { name: plan.organizationName, slug: plan.organizationSlug },
            select: { id: true, name: true, slug: true }
          })
        : await tx.employerOrganization.findUniqueOrThrow({
            where: { id: plan.organizationId },
            select: { id: true, name: true, slug: true }
          });

      const updated = await tx.interview.updateMany({
        where: { organizationId: null },
        data: { organizationId: organization.id }
      });
      const remaining = await tx.interview.count({
        where: { organizationId: null }
      });
      if (remaining !== 0) {
        throw new Error(`Backfill integrity check failed: ${remaining} interviews remain unassigned.`);
      }
      return {
        organization,
        newlyAssignedInterviewCount: updated.count,
        remainingUnassignedInterviewCount: remaining
      };
    });

    console.log(JSON.stringify({
      mode: "applied",
      organizationId: result.organization.id,
      organizationName: result.organization.name,
      organizationSlug: result.organization.slug,
      newlyAssignedInterviewCount: result.newlyAssignedInterviewCount,
      remainingUnassignedInterviewCount: result.remainingUnassignedInterviewCount
    }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
