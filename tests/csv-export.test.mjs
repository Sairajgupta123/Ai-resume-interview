import test from "node:test";
import assert from "node:assert/strict";
import { buildCsv, escapeCsvValue } from "../lib/csv-export.mjs";

test("CSV values are quoted and embedded quotes are doubled", () => {
  assert.equal(escapeCsvValue('She said "hello"'), '"She said ""hello"""');
});

test("CSV protects formula-like text values", () => {
  assert.equal(escapeCsvValue("=1+1"), "\"'=1+1\"");
  assert.equal(escapeCsvValue("  @SUM(A1:A2)"), "\"'  @SUM(A1:A2)\"");
  assert.equal(escapeCsvValue("-42"), '"-42"');
});

test("CSV preserves commas and line breaks inside quoted fields", () => {
  assert.equal(escapeCsvValue("Lucknow, India"), '"Lucknow, India"');
  assert.equal(escapeCsvValue("first\nsecond"), '"first\nsecond"');
});

test("CSV includes UTF-8 BOM and CRLF row separators", () => {
  const csv = buildCsv(["Candidate", "Role"], [["Aman", "Engineer"], ["Poonam", "Analyst"]]);
  const expected = "\uFEFF" + ['"Candidate","Role"', '"Aman","Engineer"', '"Poonam","Analyst"'].join("\r\n");
  assert.equal(csv, expected);
});

test("CSV supports empty data while retaining its header", () => {
  assert.equal(buildCsv(["Candidate", "Role"], []), "\uFEFF" + '"Candidate","Role"');
});

test("CSV rejects rows with a different number of columns", () => {
  assert.throws(() => buildCsv(["Candidate", "Role"], [["Aman"]]), /match the header/);
});

test("CSV rejects non-array inputs", () => {
  assert.throws(() => buildCsv("Candidate", []), /must be arrays/);
});
