// Shared by the CLI (Node) and the web app (browser): scoring + LLM prompts. Keep this file dependency-free.

export const DEFAULT_PROFILE = {
  name: '', email: '', phone: '', linkedin: '', github: '', portfolio: '', currentLocation: '',
  targetRoles: [], skills: [], excludeKeywords: [], locations: ['Remote'],
  strictLocation: false, remoteOnly: false, seniority: '', minSalary: '', noticePeriod: '',
  workAuthorization: '', extraNotes: '', maxAgeDays: 30,
};

const lc = (s) => String(s || '').toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
function hasWord(text, kw) {
  const k = lc(kw).trim();
  if (!k) return false;
  let re = reCache.get(k);
  if (!re) reCache.set(k, (re = new RegExp(`(^|[^a-z0-9+#])${esc(k)}($|[^a-z0-9+#])`)));
  return re.test(text);
}
const STOP = new Set(['and', 'or', 'of', 'the', 'a', 'an', '-', '/', '&', 'in', 'for']);

// Cheap keyword pre-score 0-100 (-1 = excluded). No LLM involved.
export function heuristicScore(job, p) {
  const title = lc(job.title);
  const tagText = lc((job.tags || []).join(' '));
  const text = `${title} ${tagText} ${lc(job.description)}`;
  const loc = lc(job.location);

  if ((p.excludeKeywords || []).some((k) => hasWord(`${title} ${tagText}`, k))) return -1;
  if (p.remoteOnly && !job.remote) return -1;
  if (job.postedAt && p.maxAgeDays) {
    const age = (Date.now() - new Date(job.postedAt).getTime()) / 864e5;
    if (age > p.maxAgeDays) return -1;
  }

  let roleScore = 0;
  for (const role of p.targetRoles || []) {
    if (title.includes(lc(role))) { roleScore = 50; break; }
    const tokens = lc(role).split(/\s+/).filter((t) => !STOP.has(t));
    const hit = tokens.filter((t) => hasWord(title, t)).length;
    roleScore = Math.max(roleScore, tokens.length ? (hit / tokens.length) * 35 : 0);
  }

  const skills = p.skills || [];
  const hits = skills.filter((k) => hasWord(text, k)).length;
  const skillScore = Math.min(40, (hits / Math.max(1, Math.min(skills.length, 8))) * 40);

  const locs = p.locations || [];
  const locOk = !locs.length || locs.some((l) => (/remote/i.test(l) ? job.remote : loc.includes(lc(l))));
  if (!locOk && p.strictLocation) return -1;

  return Math.round(roleScore + skillScore + (locOk ? 10 : 0));
}

export function candidateContext(p, resume) {
  const prefs = {
    targetRoles: p.targetRoles, skills: p.skills, seniority: p.seniority, locations: p.locations,
    remoteOnly: p.remoteOnly, currentLocation: p.currentLocation, minSalary: p.minSalary,
    workAuthorization: p.workAuthorization, noticePeriod: p.noticePeriod, notes: p.extraNotes,
  };
  return `CANDIDATE PREFERENCES:\n${JSON.stringify(prefs, null, 2)}\n\nCANDIDATE RESUME:\n${String(resume || '').slice(0, 15000)}`;
}

export const jobText = (j, max = 7000) =>
  `JOB\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location}\nSalary: ${j.salary || 'n/a'}\n` +
  `Tags: ${(j.tags || []).join(', ')}\nURL: ${j.url}\n\nDescription:\n${String(j.description || '').slice(0, max)}`;

export function rankMessages(p, resume, job) {
  return [
    { role: 'system', content: 'You are a senior technical recruiter. Evaluate candidate-job fit honestly and strictly. Consider hard requirements (years of experience, must-have skills, location/visa/timezone restrictions such as "US only"). Respond with JSON only.' },
    { role: 'user', content: `${candidateContext(p, resume)}\n\n---\n${jobText(job)}\n\n---\nReturn JSON: {"score": 0-100 overall fit (70+ = strong, worth applying), "verdict": "apply"|"maybe"|"skip", "summary": "one line", "matchingSkills": [], "missingSkills": [], "redFlags": ["e.g. location restriction, seniority mismatch"], "reasons": ["max 3 short bullets"]}` },
  ];
}

export function kitMessages(p, resume, job) {
  return [
    { role: 'system', content: 'You are an expert career coach and resume writer. Tailor application materials to the job. NEVER invent experience, employers, degrees, metrics or skills the candidate does not have; only reframe and emphasize what is in the resume. Write in a natural, confident, non-generic human tone (no "I am thrilled", no clichés). Respond with JSON only.' },
    { role: 'user', content: `${candidateContext(p, resume)}\n\nCandidate contact: ${p.name} | ${p.email} | ${p.phone} | ${p.linkedin} | ${p.github} ${p.portfolio || ''}\n\n---\n${jobText(job, 9000)}\n\n---\nReturn JSON:\n{"coverLetter": "max 250 words, plain text, addressed to Hiring Team at the company, ends with candidate name",\n "tailoredSummary": "3-line professional summary for the top of the resume targeted to this job",\n "resumeBulletRewrites": [{"original": "bullet from resume", "improved": "rewritten to mirror job keywords, still truthful"}],\n "atsKeywords": ["important keywords from the job the resume should contain"],\n "missingKeywords": ["job keywords absent from resume - only add if candidate genuinely has them"],\n "recruiterMessage": "LinkedIn connection note to recruiter/hiring manager, max 300 characters",\n "whyThisCompany": "2-3 sentence answer",\n "screeningAnswers": [{"question": "likely application form question", "answer": "answer"}],\n "interviewTopics": ["topics to revise for this role"]}` },
  ];
}

export function followupMessages(p, job, appliedAt, analysis) {
  return [
    { role: 'system', content: 'You write short, polite, specific job application follow-up messages. JSON only.' },
    { role: 'user', content: `Candidate: ${p.name}. Applied on ${appliedAt} for "${job.title}" at ${job.company}. Fit notes: ${JSON.stringify(analysis || {})}\nReturn {"subject": "...", "email": "max 120 words", "linkedin": "max 300 chars"}` },
  ];
}

export function profileFromResumeMessages(resume) {
  return [
    { role: 'system', content: 'You extract job-search preferences from a resume. JSON only.' },
    { role: 'user', content: `RESUME:\n${String(resume).slice(0, 15000)}\n\nReturn JSON: {"name": "", "email": "", "phone": "", "linkedin": "", "github": "", "currentLocation": "", "targetRoles": ["3-5 job titles this person should search for"], "skills": ["10-15 most marketable hard skills, short names like 'Node.js'"], "seniority": "e.g. mid-level (3-5 years)"}` },
  ];
}

export function kitMarkdown(j, k, score) {
  const list = (a) => (a || []).map((x) => `- ${x}`).join('\n');
  return `# ${j.title} @ ${j.company}

**Apply here:** ${j.url}
**Location:** ${j.location} | **Salary:** ${j.salary || 'n/a'} | **Fit score:** ${score ?? 'n/a'} | **Source:** ${j.source}

## Cover letter
${k.coverLetter}

## Tailored resume summary
${k.tailoredSummary}

## Resume bullet rewrites
${(k.resumeBulletRewrites || []).map((b) => `- ~~${b.original}~~\n  **→ ${b.improved}**`).join('\n')}

## ATS keywords to include
${(k.atsKeywords || []).join(', ')}

**Missing from your resume (add only if true):** ${(k.missingKeywords || []).join(', ') || 'none'}

## Recruiter / hiring manager message
${k.recruiterMessage}

## Why this company?
${k.whyThisCompany}

## Screening question answers
${(k.screeningAnswers || []).map((q) => `**Q: ${q.question}**\n${q.answer}`).join('\n\n')}

## Interview prep topics
${list(k.interviewTopics)}
`;
}

export function parseJSONLoose(raw) {
  const cleaned = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`LLM did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}
