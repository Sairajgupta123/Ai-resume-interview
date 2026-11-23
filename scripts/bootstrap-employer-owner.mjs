import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { hashEmployerPassword } from "../lib/employer-password.mjs";

loadEnvConfig(process.cwd());

const username = process.env.BOOTSTRAP_EMPLOYER_USERNAME?.trim();
const password = process.env.BOOTSTRAP_EMPLOYER_PASSWORD;
const organizationSlug = process.env.BOOTSTRAP_ORGANIZATION_SLUG?.trim();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured.");
if (!username || username.length > 160 || !password || !organizationSlug) {
  throw new Error("Set BOOTSTRAP_EMPLOYER_USERNAME, BOOTSTRAP_EMPLOYER_PASSWORD (12-1024 characters), and BOOTSTRAP_ORGANIZATION_SLUG explicitly.");
}
if (password.length < 12 || password.length > 1024) {
  throw new Error("BOOTSTRAP_EMPLOYER_PASSWORD must contain between 12 and 1024 characters.");
}

const prisma = new PrismaClient();
try {
  const result = await prisma.$transaction(async (tx) => {
    const organizations = await tx.employerOrganization.findMany({
      where: { slug: organizationSlug },
      take: 2,
      select: { id: true, name: true, slug: true }
    });
    if (organizations.length !== 1) {
      throw new Error("Bootstrap refused: the specified organization slug must match exactly one existing organization. Run and verify the legacy organization backfill first.");
    }
    const existing = await tx.employerUser.findUnique({ where: { username } });
    if (existing) throw new Error("Bootstrap refused: this employer username already exists. No credentials were changed.");
    const user = await tx.employerUser.create({
      data: {
        username,
        passwordHash: await hashEmployerPassword(password),
        memberships: {
          create: {
            organizationId: organizations[0].id,
            role: "owner"
          }
        }
      },
      select: { id: true, username: true }
    });
    return { user, organization: organizations[0] };
  });
  console.log(JSON.stringify({
    created: true,
    username: result.user.username,
    organizationName: result.organization.name,
    organizationSlug: result.organization.slug,
    note: "Initial owner account created. The password is not printed. Remove bootstrap credentials from the environment after use."
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
