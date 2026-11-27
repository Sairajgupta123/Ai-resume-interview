#!/usr/bin/env node
"use strict";

// One-way, resumable data copy from a frozen SQLite snapshot into an empty PostgreSQL database.
// Never run while the source application is accepting writes.
const { PrismaClient: SQLitePrismaClient } = require("../generated/sqlite-client");
const { PrismaClient: PostgresPrismaClient } = require("@prisma/client");

const BATCH_SIZE = 500;
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

async function copyTable(source, target, table, resume) {
  const sourceModel = source[table];
  const targetModel = target[table];
  const sourceCount = await sourceModel.count();
  const initialTargetCount = await targetModel.count();

  if (initialTargetCount > sourceCount) {
    throw new Error(`Target table ${table} contains more rows than the SQLite source.`);
  }
  if (initialTargetCount > 0 && !resume) {
    throw new Error(`Target table ${table} is not empty. Re-run with --resume only after confirming this is an interrupted import into the same frozen source snapshot.`);
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
  const resume = process.argv.includes("--resume");

  if (!/^file:/i.test(sourceUrl)) {
    throw new Error("Set SQLITE_DATABASE_URL to the frozen SQLite snapshot (prefer an absolute file: path).");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(targetUrl)) {
    throw new Error("Set DATABASE_URL to the PostgreSQL destination URL.");
  }
  if (process.argv.some(arg => arg !== "--resume" && arg !== process.argv[0] && arg !== process.argv[1])) {
    throw new Error("Only the optional --resume argument is supported.");
  }

  const source = new SQLitePrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new PostgresPrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    await source.$connect();
    await target.$connect();

    const targetCounts = await Promise.all(TABLES.map(async table => [table, await target[table].count()]));
    const hasExistingRows = targetCounts.some(([, count]) => count > 0);
    if (hasExistingRows && !resume) {
      throw new Error("PostgreSQL destination is not empty. Use --resume only for a previously interrupted import from the same frozen SQLite snapshot.");
    }

    let total = 0;
    for (const table of TABLES) total += await copyTable(source, target, table, resume);
    console.log(`SQLite import verified. Total source rows copied/checked: ${total}.`);
  } finally {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "SQLite import failed.");
  process.exitCode = 1;
});
