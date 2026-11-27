import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

function modelDefinitions(schema) {
  return schema
    .replace(/generator\s+client\s*\{[\s\S]*?\}\s*/, "")
    .replace(/datasource\s+db\s*\{[\s\S]*?\}\s*/, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

test("PostgreSQL and SQLite Prisma schemas define exactly the same models", async () => {
  const [postgres, sqlite] = await Promise.all([
    readFile(resolve("prisma/schema.prisma"), "utf8"),
    readFile(resolve("prisma/schema.sqlite.prisma"), "utf8")
  ]);

  assert.equal(
    modelDefinitions(postgres),
    modelDefinitions(sqlite),
    "Keep all model fields, defaults, relations and indexes identical across both provider schemas."
  );
});
