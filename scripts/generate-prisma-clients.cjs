"use strict";

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const prismaCli = resolve(__dirname, "../node_modules/prisma/build/index.js");
const env = {
  ...process.env,
  // The SQLite client is generated for the one-time importer only. A harmless
  // placeholder path avoids requiring a legacy database URL during normal builds.
  SQLITE_DATABASE_URL: process.env.SQLITE_DATABASE_URL || "file:../legacy.db"
};

for (const args of [
  ["generate"],
  ["generate", "--schema", "prisma/schema.sqlite.prisma"]
]) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: resolve(__dirname, ".."),
    env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
