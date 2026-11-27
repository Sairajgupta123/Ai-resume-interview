import test from "node:test";
import assert from "node:assert/strict";
import { buildEmployerAnalytics } from "../lib/employer-analytics-policy.mjs";

const now = new Date("2026-11-20T12:00:00.000Z");
const makeReport = (score, recommendation) => JSON.stringify({
  overallScore: score, recommendation,
  summary: "Demonstrated job-related knowledge and problem solving.",
  disclaimer: "AI assessment is advisory and requires human review.",
  strengths: [], improvementAreas: [],
  skills: [{ skill: "Problem solving", rating: "Good", evidence: "Explained a practical solution clearly." }],
  questionFeedback: []
});
const rows = [
  { status: "completed", overallScore: 12, reportJson: makeReport(90, "Strong match"), role: "Backend Engineer", employerDecision: "shortlist", createdAt: "2026-11-20T10:00:00.000Z" },
  { status: "completed", overallScore: 99, reportJson: makeReport(70, "Consider"), role: "Backend Engineer", employerDecision: "review", createdAt: "2026-11-19T10:00:00.000Z" },
  { status: "completed", overallScore: null, reportJson: "{broken", role: "Data Analyst", employerDecision: null, createdAt: "2026-11-18T10:00:00.000Z" },
  { status: "invited", overallScore: null, reportJson: null, role: "Data Analyst", employerDecision: "reject", createdAt: "2026-11-17T10:00:00.000Z" },
  { status: "in_progress", overallScore: null, reportJson: null, role: "QA Engineer", employerDecision: null, createdAt: "2026-11-16T10:00:00.000Z" }
];

test("calculates totals, completion rate and average only from scored completed interviews", () => {
  const result = buildEmployerAnalytics(rows, now);
  assert.equal(result.total, 5);
  assert.equal(result.completed, 3);
  assert.equal(result.completionRate, 60);
  assert.equal(result.averageScore, 80);
  assert.equal(result.scoredCount, 2);
});

test("uses validated report scores instead of stale columns and ignores malformed reports", () => {
  const result = buildEmployerAnalytics([
    { ...rows[0], overallScore: 0 },
    { ...rows[1], overallScore: 100 },
    rows[2]
  ], now);
  assert.equal(result.averageScore, 80);
  assert.equal(result.scoredCount, 2);
});

test("does not count an incomplete or malformed report as a scored assessment", () => {
  const result = buildEmployerAnalytics([
    { status: "completed", overallScore: 95, reportJson: JSON.stringify({ overallScore: 95 }), createdAt: now }
  ], now);
  assert.equal(result.averageScore, null);
  assert.equal(result.scoredCount, 0);
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

import { buildEmployerAnalyticsFromAggregates, buildEmployerAnalyticsWeekWindows } from "../lib/employer-analytics-policy.mjs";

test("aggregate database inputs produce the same analytics as row-based calculation", () => {
  const windows = buildEmployerAnalyticsWeekWindows(now);
  const weeklyCounts = windows.map(window => {
    const matches = rows.filter(row => {
      const createdAt = new Date(row.createdAt);
      return createdAt >= window.start && (createdAt < window.end || (window === windows[5] && createdAt <= now));
    });
    return { total: matches.length, completed: matches.filter(row => row.status === "completed").length };
  });
  const statusCounts = {};
  const decisionCounts = {};
  const roleCounts = new Map();
  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    decisionCounts[row.employerDecision ?? "pending"] = (decisionCounts[row.employerDecision ?? "pending"] || 0) + 1;
    roleCounts.set(row.role, (roleCounts.get(row.role) || 0) + 1);
  }
  const aggregateResult = buildEmployerAnalyticsFromAggregates({
    statusCounts,
    decisionCounts,
    roleCounts: [...roleCounts].map(([role, count]) => ({ role, count })),
    weeklyCounts,
    completedReports: rows.filter(row => row.status === "completed" && row.reportJson).map(row => ({ reportJson: row.reportJson }))
  }, now);
  assert.deepEqual(aggregateResult, buildEmployerAnalytics(rows, now));
});

test("excludes future-dated records from the current six-week trend", () => {
  const future = new Date(now.getTime() + 60 * 60 * 1000);
  const result = buildEmployerAnalytics([
    { ...rows[0], createdAt: future }
  ], now);
  assert.equal(result.weeklyTrend.reduce((sum, week) => sum + week.total, 0), 0);
});
