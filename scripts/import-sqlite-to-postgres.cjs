#!/usr/bin/env node
"use strict";

// One-way, resumable data copy from a frozen SQLite snapshot into an empty PostgreSQL database.
// Never run while the source application is accepting writes.
const { createHash } = require("node:crypto");
const { PrismaClient: SQLitePrismaClient } = require("../generated/sqlite-client");
const { PrismaClient: PostgresPrismaClient } = require("@prisma/client");

const BATCH_SIZE = 500;
const IMPORT_STATE_ID = "sqlite-to-postgres-v1";
const IMPORT_STATE_TABLE = "_MZOBS_SQLITE_IMPORT_STATE";
const TABLES = [
  "interview",
  "loginAttempt",
  "interviewMessage",
  "employerDecisionHistory",
  "interviewSignal",
  "privacyDeletionRequest",
  "privacyDeletionEvent"
];

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function sameRecord(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

async function fingerprintSource(source) {
  const hash = createHash("sha256");
  const counts = {};

  for (const table of TABLES) {
    const model = source[table];
    const count = await model.count();
    counts[table] = count;
    hash.update(`${table}\0${count}\n`);

    let cursor;
    while (true) {
      const rows = await model.findMany({
        take: BATCH_SIZE,
        orderBy: { id: "asc" },
        ...(cursor ? { where: { id: { gt: cursor } } } : {})
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        hash.update(JSON.stringify(canonical(row)));
        hash.update("\n");
      }
      cursor = rows[rows.length - 1].id;
    }
  }

  return { fingerprint: hash.digest("hex"), counts };
}

async function prepareImportState(target, fingerprint, resume, hasExistingRows) {
  await target.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${IMPORT_STATE_TABLE}" (
      "id" TEXT PRIMARY KEY,
      "sourceFingerprint" TEXT NOT NULL,
      "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" TIMESTAMPTZ
    )`
  );

  const states = await target.$queryRawUnsafe(
    `SELECT "sourceFingerprint", "completedAt" FROM "${IMPORT_STATE_TABLE}" WHERE "id" = $1 LIMIT 1`,
    IMPORT_STATE_ID
  );
  const state = states[0];

  if (state) {
    if (state.sourceFingerprint !== fingerprint) {
      throw new Error("SQLite source snapshot fingerprint differs from the interrupted import. Refusing to resume against changed source data.");
    }
    if (!resume) {
      throw new Error("An import state already exists. Use --resume only with the exact same frozen SQLite snapshot.");
    }
    return;
  }

  if (hasExistingRows) {
    throw new Error("PostgreSQL contains rows but has no verified import state. Refusing an unsafe resume; restore an empty destination before retrying.");
  }

  await target.$executeRawUnsafe(
    `INSERT INTO "${IMPORT_STATE_TABLE}" ("id", "sourceFingerprint") VALUES ($1, $2)`,
    IMPORT_STATE_ID,
    fingerprint
  );
}

async function copyTable(source, target, table, sourceCount, resume) {
  const sourceModel = source[table];
  const targetModel = target[table];
  const initialTargetCount = await targetModel.count();

  if (initialTargetCount > sourceCount) {
    throw new Error(`Target table ${table} contains more rows than the SQLite source.`);
  }
  if (initialTargetCount > 0 && !resume) {
    throw new Error(`Target table ${table} is not empty. Re-run with --resume only for the same fingerprint-verified source snapshot.`);
  }

  let cursor;
  let copied = 0;
  while (true) {
    const rows = await sourceModel.findMany({
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
      ...(cursor ? { where: { id: { gt: cursor } } } : {})
    });
    if (rows.length === 0) break;

    await targetModel.createMany({ data: rows, skipDuplicates: true });
    const ids = rows.map(row => row.id);
    const destinationRows = await targetModel.findMany({ where: { id: { in: ids } } });
    const byId = new Map(destinationRows.map(row => [row.id, row]));

    for (const row of rows) {
      const destination = byId.get(row.id);
      if (!destination || !sameRecord(row, destination)) {
        throw new Error(`Data verification failed for table ${table}; record values were not logged.`);
      }
    }

    cursor = rows[rows.length - 1].id;
    copied += rows.length;
  }

  const finalTargetCount = await targetModel.count();
  if (finalTargetCount !== sourceCount) {
    throw new Error(`Row-count verification failed for ${table}: source=${sourceCount}, target=${finalTargetCount}.`);
  }
  console.log(`${table}: verified ${finalTargetCount} rows`);
  return copied;
}

async function main() {
  const sourceUrl = process.env.SQLITE_DATABASE_URL || "";
  const targetUrl = process.env.DATABASE_URL || "";
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");

  if (args.some(arg => arg !== "--resume") || args.filter(arg => arg === "--resume").length > 1) {
    throw new Error("Only one optional --resume argument is supported.");
  }
  if (!/^file:/i.test(sourceUrl)) {
    throw new Error("Set SQLITE_DATABASE_URL to the frozen SQLite snapshot (prefer an absolute file: path).");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(targetUrl)) {
    throw new Error("Set DATABASE_URL to the PostgreSQL destination URL.");
  }

  const source = new SQLitePrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new PostgresPrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    await source.$connect();
    await target.$connect();

    const { fingerprint, counts } = await fingerprintSource(source);
    const targetCounts = await Promise.all(TABLES.map(async table => [table, await target[table].count()]));
    const hasExistingRows = targetCounts.some(([, count]) => count > 0);
    await prepareImportState(target, fingerprint, resume, hasExistingRows);

    let total = 0;
    for (const table of TABLES) total += await copyTable(source, target, table, counts[table], resume);

    // Re-hash after copying so writes made to the source during the import cannot
    // produce a mixed snapshot that is incorrectly marked complete.
    const finalSource = await fingerprintSource(source);
    if (finalSource.fingerprint !== fingerprint) {
      throw new Error("SQLite source changed during import. Destination is not certified complete; freeze a new source snapshot and restore an empty destination before starting over.");
    }

    await target.$executeRawUnsafe(
      `UPDATE "${IMPORT_STATE_TABLE}" SET "completedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      IMPORT_STATE_ID
    );
    console.log(`SQLite import verified. Total source rows copied/checked: ${total}.`);
  } finally {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "SQLite import failed.");
  process.exitCode = 1;
});
