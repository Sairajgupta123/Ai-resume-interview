const CATEGORY_RULES = [
  {
    id: "situational",
    label: "Situational judgment",
    pattern: /\b(what would you do|how would you handle|scenario|conflict|disagreement|deadline|prioriti[sz]|stakeholder|production incident|outage|under pressure)\b/i
  },
  {
    id: "project",
    label: "Project and experience validation",
    pattern: /\b(project|resume|portfolio|your contribution|your role|built|developed|implemented|delivered|team project|real example)\b/i
  },
  {
    id: "practical",
    label: "Practical problem solving",
    pattern: /\b(debug|troubleshoot|design|architecture|optimi[sz]|implement|approach|solve|investigate|test|failure|scalab)\b/i
  },
  {
    id: "technical",
    label: "Technical foundations",
    pattern: /\b(explain|what is|how does|difference between|when would|why would|concept|principle|algorithm|database|api|programming)\b/i
  }
];

export const INTERVIEW_QUESTION_CATEGORIES = CATEGORY_RULES.map(({ id, label }) => ({ id, label }));

export function classifyInterviewQuestion(question) {
  if (typeof question !== "string" || !question.trim()) return null;
  return CATEGORY_RULES.find(category => category.pattern.test(question))?.id || null;
}

/**
 * A transcript-derived coverage planner. It guides question selection only;
 * category counts are not evidence scores and never rate a candidate.
 */
export function buildInterviewStructurePlan(history, elapsedSeconds = 0, limitSeconds = 15 * 60) {
  const safeHistory = Array.isArray(history)
    ? history.filter(item => item && item.role === "assistant" && typeof item.content === "string").slice(-40)
    : [];
  const categoryCounts = Object.fromEntries(CATEGORY_RULES.map(category => [category.id, 0]));
  for (const message of safeHistory) {
    const category = classifyInterviewQuestion(message.content);
    if (category) categoryCounts[category] += 1;
  }
  const remainingSeconds = Math.max(0, (Number.isFinite(limitSeconds) ? limitSeconds : 15 * 60) - (Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0));
  const remainingCategories = CATEGORY_RULES
    .filter(category => categoryCounts[category.id] === 0)
    .map(category => category.id);
  const nextCategory = remainingSeconds <= 90
    ? null
    : [...CATEGORY_RULES].sort((a, b) => categoryCounts[a.id] - categoryCounts[b.id])[0]?.id || null;
  return {
    categoryCounts,
    remainingCategories,
    nextCategory,
    remainingSeconds,
    phase: remainingSeconds <= 90 ? "wrap_up" : safeHistory.length < 2 ? "opening" : "assessment"
  };
}

export function buildInterviewStructureGuidance(plan) {
  if (!plan) return "Use a balanced, role-relevant interview structure.";
  if (plan.phase === "wrap_up") {
    return "STRUCTURED INTERVIEW: Enter the wrap-up phase. Ask at most one concise essential clarification, then close respectfully. Do not start a new competency area.";
  }
  const next = CATEGORY_RULES.find(category => category.id === plan.nextCategory);
  const remaining = plan.remainingCategories.map(id => CATEGORY_RULES.find(category => category.id === id)?.label).filter(Boolean);
  return [
    "STRUCTURED INTERVIEW COVERAGE:",
    next ? "Prioritize this next question type: " + next.label + "." : "Continue with the least-covered question type.",
    remaining.length ? "Not yet covered: " + remaining.join(", ") + "." : "All four question types have appeared; maintain balanced coverage.",
    "Use job-related technical foundations, practical problem solving, project/experience validation, and situational judgment. Tailor examples to the resume, but keep the role's required competencies unchanged.",
    "Ask one question at a time. This plan guides question selection only; do not treat category counts as a candidate score."
  ].join("\n");
}
