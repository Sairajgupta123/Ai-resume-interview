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
  const report = safeObject(candidate.reportJson);
  const skills = Array.isArray(report?.skills) ? report.skills : [];
  const bySkill = new Map();
  for (const item of skills) {
    const key = normalize(item?.skill);
    if (!key || bySkill.has(key)) continue;
    const rating = RATING_ORDER.includes(item.rating) ? item.rating : "Insufficient evidence";
    const evidence = typeof item.evidence === "string" && item.evidence.trim()
      ? item.evidence.trim()
      : "Insufficient evidence";
    bySkill.set(key, { skill: String(item.skill).trim(), rating, evidence });
  }
  return {
    id: String(candidate.id),
    candidateName: String(candidate.candidateName || "Candidate"),
    role: String(candidate.role || ""),
    overallScore: Number.isInteger(candidate.overallScore) ? candidate.overallScore : null,
    recommendation: typeof candidate.recommendation === "string" ? candidate.recommendation : "Needs review",
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
