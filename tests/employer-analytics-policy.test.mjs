import test from "node:test";
import assert from "node:assert/strict";
import { buildEmployerAnalytics } from "../lib/employer-analytics-policy.mjs";

const now = new Date("2026-11-20T12:00:00.000Z");
const rows = [
  { status: "completed", overallScore: 90, role: "Backend Engineer", employerDecision: "shortlist", createdAt: "2026-11-20T10:00:00.000Z" },
  { status: "completed", overallScore: 70, role: "Backend Engineer", employerDecision: "review", createdAt: "2026-11-19T10:00:00.000Z" },
  { status: "completed", overallScore: null, role: "Data Analyst", employerDecision: null, createdAt: "2026-11-18T10:00:00.000Z" },
  { status: "invited", overallScore: null, role: "Data Analyst", employerDecision: "reject", createdAt: "2026-11-17T10:00:00.000Z" },
  { status: "in_progress", overallScore: null, role: "QA Engineer", employerDecision: null, createdAt: "2026-11-16T10:00:00.000Z" }
];

test("calculates totals, completion rate and average only from scored completed interviews", () => {
  const result = buildEmployerAnalytics(rows, now);
  assert.equal(result.total, 5);
  assert.equal(result.completed, 3);
  assert.equal(result.completionRate, 60);
  assert.equal(result.averageScore, 80);
  assert.equal(result.scoredCount, 2);
});

test("separates employer decisions from AI recommendations", () => {
  const result = buildEmployerAnalytics(rows, now);
  assert.deepEqual(result.decisions, { shortlist: 1, review: 1, reject: 1, pending: 2 });
});

test("groups valid scores into non-overlapping score bands", () => {
  const result = buildEmployerAnalytics(rows, now);
  assert.deepEqual(result.scoreBands.map(x => x.count), [1, 1, 0]);
});

test("ranks roles by interview volume and limits output to five", () => {
  const result = buildEmployerAnalytics([
    ...rows,
    ...["A", "B", "C", "D", "E", "F"].map(role => ({ status: "invited", overallScore: null, role, employerDecision: null, createdAt: now }))
  ], now);
  assert.equal(result.roles.length, 5);
  assert.equal(result.roles[0].role, "Backend Engineer");
});

test("returns stable six-week trend and ignores invalid timestamps", () => {
  const result = buildEmployerAnalytics([...rows, { ...rows[0], createdAt: "not-a-date" }], now);
  assert.equal(result.weeklyTrend.length, 6);
  assert.equal(result.weeklyTrend.reduce((sum, week) => sum + week.total, 0), 5);
  assert.equal(result.weeklyTrend.reduce((sum, week) => sum + week.completed, 0), 3);
});

test("handles an empty dataset without division errors", () => {
  const result = buildEmployerAnalytics([], now);
  assert.equal(result.completionRate, 0);
  assert.equal(result.averageScore, null);
  assert.deepEqual(result.roles, []);
  assert.deepEqual(result.decisions, { shortlist: 0, review: 0, reject: 0, pending: 0 });
});
