import { buildSkillCoverage, skillMentionedInText } from "./skill-coverage-policy.mjs";

export const DEFAULT_INTERVIEW_LIMIT_SECONDS = 15 * 60;
export const MAX_QUESTIONS_PER_SKILL = 2;
export const WRAP_UP_REMAINING_SECONDS = 90;

function normalizeHistory(history) {
  return Array.isArray(history)
    ? history.filter(message => message && (message.role === "assistant" || message.role === "user") && typeof message.content === "string").slice(-40)
    : [];
}

export function buildInterviewFairnessPlan(targetSkills, history, elapsedSeconds = 0, limitSeconds = DEFAULT_INTERVIEW_LIMIT_SECONDS) {
  const safeHistory = normalizeHistory(history);
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const safeLimit = Number.isFinite(limitSeconds) ? Math.max(60, limitSeconds) : DEFAULT_INTERVIEW_LIMIT_SECONDS;
  const coverage = buildSkillCoverage(targetSkills, safeHistory);
  const questionCounts = (Array.isArray(targetSkills) ? targetSkills : []).slice(0, 15).map(skill => {
    const matchingQuestions = safeHistory.filter(message =>
      message.role === "assistant" &&
      skillMentionedInText(message.content, skill)
    ).length;
    return { skill, questions: matchingQuestions, capped: matchingQuestions >= MAX_QUESTIONS_PER_SKILL };
  });
  const remainingSeconds = Math.max(0, safeLimit - safeElapsed);
  const cappedSkills = questionCounts.filter(item => item.capped).map(item => item.skill);
  const plan = {
    coverage,
    questionCounts,
    cappedSkills,
    remainingSeconds,
    phase: remainingSeconds <= WRAP_UP_REMAINING_SECONDS ? "wrap_up" : "normal"
  };
  return plan;
}

export function buildFairnessGuidance(plan) {
  if (!plan || !plan.coverage) {
    return "Use a consistent, job-related interview structure. Ask one question at a time and avoid irrelevant personal topics.";
  }
  const lines = [
    "FAIRNESS AND CONSISTENCY RULES:",
    "Use the same role-related competency areas and comparable evidence standards for candidates applying to this role; wording and follow-ups may adapt to each candidate's answer.",
    "Ask only job-related questions. Do not ask about or infer protected or sensitive personal characteristics.",
    "Do not spend the interview repeatedly testing one skill while other important target skills remain uncovered."
  ];
  if (plan.cappedSkills.length) {
    lines.push("Question cap reached for these skills; do not ask another standalone question about them unless a brief clarification is essential: " + plan.cappedSkills.join(", ") + ".");
  }
  if (plan.coverage.remaining.length) {
    lines.push("Prioritize uncovered job skills next: " + plan.coverage.remaining.slice(0, 4).join(", ") + ".");
  }
  if (plan.coverage.followUp.length) {
    lines.push("A question is awaiting an answer for: " + plan.coverage.followUp.slice(0, 3).join(", ") + ". Do not assume the skill was demonstrated.");
  }
  if (plan.phase === "wrap_up") {
    lines.push("The interview is in its final 90 seconds. Ask at most one concise high-value clarification if necessary, then provide a respectful closing statement with done=true.");
  } else {
    lines.push("Balance technical knowledge, practical project/problem-solving evidence, and role-relevant collaboration or situational judgment across the interview.");
  }
  lines.push("Consistency means comparable job-related criteria and evidence standards, not identical questions or assumptions about a candidate.");
  return lines.join("\n");
}
