const ACTION_CUES = /\b(built|designed|implemented|debugged|optimized|migrated|deployed|measured|tested|reduced|increased|improved|integrated|configured|led|created|developed|refactored|analyzed)\b/i;
const TECHNICAL_CUES = /\b(api|database|sql|react|node\.?js|python|java|typescript|javascript|aws|azure|docker|kubernetes|redis|mongodb|postgres(?:ql)?|machine learning|model|algorithm|cache|queue|microservice|latency|authentication|authorization|testing|ci\/cd)\b/i;
const QUANTITATIVE_CUES = /\b\d+(?:\.\d+)?\s*(?:%|ms|seconds?|minutes?|hours?|days?|x|users?|requests?|records?|gb|mb)?\b/i;
const TRADEOFF_CUES = /\b(trade-?off|alternative|instead|because|constraint|bottleneck|failure|risk|chose|choice|compared|approach)\b/i;

export function assessAnswerDepth(answer) {
  if (typeof answer !== "string" || !answer.trim()) return "clarify";
  const words = answer.trim().split(/\s+/).length;
  const signals = [
    ACTION_CUES.test(answer),
    TECHNICAL_CUES.test(answer),
    QUANTITATIVE_CUES.test(answer),
    TRADEOFF_CUES.test(answer)
  ].filter(Boolean).length;

  // This is a prompt-selection heuristic, not a candidate score or a measure of ability.
  if (words < 35 || signals === 0) return "clarify";
  if (signals >= 3 && words >= 80) return "deepen";
  return "probe";
}

export function buildAdaptiveGuidance(answer) {
  const depth = assessAnswerDepth(answer);
  if (depth === "clarify") {
    return {
      depth,
      instruction: "The last answer contained limited concrete detail. Ask one supportive clarification that invites a specific example, the candidate's own actions, and the outcome. Do not treat brevity as low competence."
    };
  }
  if (depth === "deepen") {
    return {
      depth,
      instruction: "The last answer included several concrete signals. Increase technical depth with one focused question about design choices, trade-offs, testing, failure handling, or measurable impact. Do not assume the answer is correct without probing."
    };
  }
  return {
    depth,
    instruction: "The last answer contains some concrete detail. Ask one targeted follow-up to verify the candidate's personal contribution, reasoning, or validation method before moving to a different job-relevant skill."
  };
}
