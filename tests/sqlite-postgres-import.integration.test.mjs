import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("SQLite importer preserves all seven models and their relationships in PostgreSQL", async () => {
  const baseUrl = process.env.DATABASE_URL || "";
  assert.ok(/^postgres(?:ql)?:\/\//i.test(baseUrl), "PostgreSQL DATABASE_URL is required for migration integration tests");
  const tempDir = await mkdtemp(join(tmpdir(), "mzobs-sqlite-import-"));
  const sqliteUrl = `file:${join(tempDir, "source.db").replaceAll("\\", "/")}`;
  const schemaName = `import_test_${randomUUID().replaceAll("-", "")}`;
  const targetUrl = new URL(baseUrl);
  targetUrl.searchParams.set("schema", schemaName);
  const targetDatabaseUrl = targetUrl.toString();
  const projectRoot = resolve(".");
  let sqlite;
  let admin;
  let postgres;

  try {
    execFileSync(
      process.execPath,
      [resolve(projectRoot, "node_modules/prisma/build/index.js"), "db", "push", "--schema", "prisma/schema.sqlite.prisma", "--skip-generate"],
      { cwd: projectRoot, env: { ...process.env, SQLITE_DATABASE_URL: sqliteUrl }, stdio: "pipe" }
    );
    const { PrismaClient: SQLitePrismaClient } = await import("../generated/sqlite-client/index.js");
    const { PrismaClient: PostgresPrismaClient } = await import("@prisma/client");
    sqlite = new SQLitePrismaClient({ datasources: { db: { url: sqliteUrl } } });
    await sqlite.$connect();

    const interview = await sqlite.interview.create({
      data: {
        candidateName: "Migration Fixture – 候选人",
        role: "Backend Engineer",
        resumeText: "Unicode résumé fixture",
        jobDescription: "Preserve exact source content",
        candidateEmail: "migration-fixture@example.test",
        invitationTokenHash: "fixture-invitation-hash",
        messages: { create: [{ role: "user", content: "A transcript answer with Unicode ✓" }] },
        decisionHistory: { create: [{ decision: "review", notes: "Keep this decision note" }] },
        signals: { create: [{ sender: "candidate", kind: "ice", payload: '{"candidate":true}' }] }
      }
    });
    await sqlite.loginAttempt.create({
      data: { key: "fixture-rate-limit-key", attempts: 3, blockedUntil: null }
    });
    const deletionRequest = await sqlite.privacyDeletionRequest.create({
      data: {
        interviewId: interview.id,
        candidateNameSnapshot: interview.candidateName,
        candidateEmailSnapshot: interview.candidateEmail,
        roleSnapshot: interview.role,
        reason: "Fixture deletion request",
        requestedBy: "candidate",
        verificationTokenHash: "fixture-verification-hash",
        events: { create: [{ action: "request_created", actor: "candidate", details: "Fixture event detail" }] }
      }
    });
    assert.ok(deletionRequest.id);

    admin = new PostgresPrismaClient({ datasources: { db: { url: baseUrl } } });
    await admin.$connect();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    execFileSync(
      process.execPath,
      [resolve(projectRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", "prisma/schema.prisma"],
      { cwd: projectRoot, env: { ...process.env, DATABASE_URL: targetDatabaseUrl }, stdio: "pipe" }
    );

    execFileSync(
      process.execPath,
      [resolve(projectRoot, "scripts/import-sqlite-to-postgres.cjs")],
      { cwd: projectRoot, env: { ...process.env, SQLITE_DATABASE_URL: sqliteUrl, DATABASE_URL: targetDatabaseUrl }, stdio: "pipe" }
    );

    postgres = new PostgresPrismaClient({ datasources: { db: { url: targetDatabaseUrl } } });
    await postgres.$connect();
    const copiedInterview = await postgres.interview.findUnique({
      where: { id: interview.id },
      include: { messages: true, decisionHistory: true, signals: true }
    });
    assert.ok(copiedInterview);
    assert.equal(copiedInterview.candidateName, "Migration Fixture – 候选人");
    assert.equal(copiedInterview.resumeText, "Unicode résumé fixture");
    assert.equal(copiedInterview.messages[0].content, "A transcript answer with Unicode ✓");
    assert.equal(copiedInterview.decisionHistory[0].notes, "Keep this decision note");
    assert.equal(copiedInterview.signals[0].payload, '{"candidate":true}');
    assert.equal(await postgres.loginAttempt.count(), 1);
    const copiedDeletion = await postgres.privacyDeletionRequest.findUnique({
      where: { id: deletionRequest.id },
      include: { events: true }
    });
    assert.equal(copiedDeletion.verificationTokenHash, "fixture-verification-hash");
    assert.equal(copiedDeletion.events[0].details, "Fixture event detail");
  } finally {
    if (postgres) await postgres.$disconnect();
    if (sqlite) await sqlite.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.$disconnect();
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
