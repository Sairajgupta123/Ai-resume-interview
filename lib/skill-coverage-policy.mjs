const SKILL_CATALOG = [
  ["JavaScript", ["javascript", "js", "ecmascript"]],
  ["TypeScript", ["typescript", "ts"]],
  ["React", ["react", "react.js", "reactjs"]],
  ["Next.js", ["next.js", "nextjs"]],
  ["Node.js", ["node.js", "nodejs"]],
  ["Express", ["express", "express.js"]],
  ["Python", ["python"]],
  ["Java", ["java"]],
  ["C++", ["c++", "cpp"]],
  ["SQL", ["sql", "mysql", "postgresql", "postgres", "sqlite"]],
  ["MongoDB", ["mongodb", "mongo"]],
  ["REST APIs", ["rest api", "restful", "api design"]],
  ["Data Structures", ["data structures", "dsa", "algorithms", "complexity", "big o"]],
  ["HTML/CSS", ["html", "css", "responsive design"]],
  ["Git", ["git", "github", "version control"]],
  ["Docker", ["docker", "containerization"]],
  ["AWS", ["aws", "amazon web services"]],
  ["Azure", ["azure"]],
  ["Machine Learning", ["machine learning", "scikit-learn", "tensorflow", "pytorch"]],
  ["Testing", ["unit testing", "integration testing", "jest", "testing", "test cases"]],
  ["System Design", ["system design", "scalability", "distributed systems", "architecture"]],
  ["Communication", ["stakeholder communication", "client communication", "cross-functional"]]
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text, term) {
  const normalizedTerm = term.toLocaleLowerCase();
  // "js" is a common alias for JavaScript, but must not match the suffix
  // of "Node.js". Treat dots as token characters for this alias only.
  const boundary = normalizedTerm === "js" ? "[^a-z0-9.]" : "[^a-z0-9]";
  const pattern = new RegExp("(^|" + boundary + ")" + escapeRegex(normalizedTerm) + "($|" + boundary + ")", "i");
  return pattern.test(text);
}

export function extractTargetSkills(jobDescription, resume = "", limit = 10) {
  const jd = typeof jobDescription === "string" ? jobDescription : "";
  const cv = typeof resume === "string" ? resume : "";
  const jdMatches = [];
  const resumeMatches = [];
  for (const [name, aliases] of SKILL_CATALOG) {
    if (aliases.some(alias => containsTerm(jd, alias))) jdMatches.push(name);
    else if (aliases.some(alias => containsTerm(cv, alias))) resumeMatches.push(name);
  }
  return [...jdMatches, ...resumeMatches].slice(0, Math.max(1, Math.min(limit, 15)));
}

export function buildSkillCoverage(targetSkills, history) {
  const safeSkills = Array.isArray(targetSkills) ? targetSkills.slice(0, 15) : [];
  const safeHistory = Array.isArray(history) ? history.slice(-40) : [];
  const rows = safeSkills.map(skill => {
    const aliases = SKILL_CATALOG.find(([name]) => name.toLocaleLowerCase() === String(skill).toLocaleLowerCase())?.[1] || [String(skill).toLocaleLowerCase()];
    let asked = false;
    let answered = false;
    for (let index = 0; index < safeHistory.length; index++) {
      const message = safeHistory[index];
      if (message?.role !== "assistant" || typeof message.content !== "string") continue;
      const asksAboutSkill = aliases.some(alias => containsTerm(message.content, alias));
      if (!asksAboutSkill) continue;
      asked = true;
      const next = safeHistory[index + 1];
      if (next?.role === "user" && typeof next.content === "string" && next.content.trim()) answered = true;
    }
    return { skill, status: answered ? "answered" : asked ? "asked_unanswered" : "not_asked" };
  });
  const answered = rows.filter(row => row.status === "answered").length;
  return {
    skills: rows,
    answered,
    total: rows.length,
    percent: rows.length ? Math.round(answered / rows.length * 100) : 0,
    remaining: rows.filter(row => row.status === "not_asked").map(row => row.skill),
    followUp: rows.filter(row => row.status === "asked_unanswered").map(row => row.skill)
  };
}

export function buildCoverageGuidance(coverage) {
  if (!coverage || !coverage.total) {
    return "No reliable target skills could be extracted. Continue with resume and role-specific questions; do not invent required skills.";
  }
  const followUp = coverage.followUp.slice(0, 3);
  const remaining = coverage.remaining.slice(0, 5);
  const parts = [];
  if (followUp.length) parts.push("First consider a concise follow-up to collect evidence for an already asked skill: " + followUp.join(", ") + ".");
  if (remaining.length) parts.push("Skills not yet covered: " + remaining.join(", ") + ". Prioritize the most job-critical skill and ask one at a time.");
  if (!followUp.length && !remaining.length) parts.push("All extracted target skills have at least one answer. Use remaining time for one deeper verification or a situational question.");
  parts.push("Coverage is a planning aid, not a candidate score. Do not claim a skill is demonstrated merely because it appeared in a question.");
  return parts.join(" ");
}
