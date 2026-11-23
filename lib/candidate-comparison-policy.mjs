const RATING_ORDER = ["Strong", "Good", "Developing", "Insufficient evidence"];

function safeObject(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalize(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/\s+/g, " ") : "";
}

function cleanCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Every selected candidate must have a valid completed report with skill evidence.");
  }
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  if (!id || id.length > 128) {
    throw new Error("Every selected candidate must have a valid completed report with skill evidence.");
  }
  const report = safeObject(candidate.reportJson);
  const skills = Array.isArray(report?.skills) ? report.skills : [];
  const bySkill = new Map();
  for (const item of skills) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const key = normalize(item.skill);
    if (!key || key.length > 120 || bySkill.has(key)) continue;
    const rating = RATING_ORDER.includes(item.rating) ? item.rating : "Insufficient evidence";
    const rawEvidence = typeof item.evidence === "string" ? item.evidence.trim() : "";
    const evidence = rawEvidence && rawEvidence.length <= 1200
      ? rawEvidence
      : "Insufficient evidence";
    bySkill.set(key, {
      skill: String(item.skill).trim().slice(0, 120),
      rating,
      evidence
    });
  }
  const rawScore = candidate.overallScore;
  const overallScore = Number.isInteger(rawScore) && rawScore >= 0 && rawScore <= 100 ? rawScore : null;
  const rawRecommendation = typeof candidate.recommendation === "string" ? candidate.recommendation : "";
  const recommendation = ["Strong match", "Consider", "Needs review"].includes(rawRecommendation)
    ? rawRecommendation
    : "Needs review";
  return {
    id,
    candidateName: typeof candidate.candidateName === "string" && candidate.candidateName.trim()
      ? candidate.candidateName.trim().slice(0, 160)
      : "Candidate",
    role: typeof candidate.role === "string" ? candidate.role.trim().slice(0, 160) : "",
    overallScore,
    recommendation,
    skills: bySkill
  };
}

export function buildCandidateComparison(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 3) {
    throw new Error("Select between two and three candidates to compare.");
  }
  const cleaned = candidates.map(cleanCandidate);
  if (cleaned.some(candidate => !candidate.id || candidate.skills.size === 0)) {
    throw new Error("Every selected candidate must have a valid completed report with skill evidence.");
  }
  const roles = new Set(cleaned.map(candidate => normalize(candidate.role)));
  const sameRole = roles.size === 1;
  const allSkills = new Map();
  for (const candidate of cleaned) {
    for (const [key, item] of candidate.skills) {
      if (!allSkills.has(key)) allSkills.set(key, item.skill);
    }
  }
  const skills = [...allSkills.entries()].map(([key, label]) => ({
    skill: label,
    candidates: cleaned.map(candidate => {
      const item = candidate.skills.get(key);
      return item
        ? { candidateId: candidate.id, rating: item.rating, evidence: item.evidence }
        : { candidateId: candidate.id, rating: "Insufficient evidence", evidence: "Insufficient evidence" };
    })
  }));
  const candidateSummaries = cleaned.map(candidate => ({
    id: candidate.id,
    candidateName: candidate.candidateName,
    role: candidate.role,
    overallScore: candidate.overallScore,
    recommendation: candidate.recommendation,
    evidenceSkillCount: [...candidate.skills.values()].filter(item => item.evidence !== "Insufficient evidence").length,
    reportedSkillCount: candidate.skills.size
  }));
  return {
    sameRole,
    comparisonNote: sameRole
      ? "Candidates are compared across the union of reported job-related skills. Missing evidence is not proof of missing ability. AI scores and recommendations are advisory; review source answers before making a hiring decision."
      : "Selected candidates have different role labels. This is a descriptive evidence view only; do not compare scores or ratings as if they shared one job standard.",
    candidates: candidateSummaries,
    skills
  };
}
