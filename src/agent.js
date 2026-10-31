import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './paths.js';
import { readResumeText } from './resume.js';
import { chatJSON } from './llm.js';
import { fetchAllJobs } from './sources.js';
import * as db from './db.js';

const lc = (s) => String(s || '').toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, kw) => new RegExp(`(^|[^a-z0-9+#])${esc(lc(kw))}($|[^a-z0-9+#])`).test(text);
const STOP = new Set(['and', 'or', 'of', 'the', 'a', 'an', '-', '/', '&', 'in', 'for']);
const slug = (s) => lc(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

// ---------- Cheap pre-filter (no LLM) ----------
export function heuristicScore(job, p) {
  const title = lc(job.title);
  const tagText = lc(job.tags.join(' '));
  const text = `${title} ${tagText} ${lc(job.description)}`;
  const loc = lc(job.location);

  if (p.excludeKeywords.some((k) => hasWord(`${title} ${tagText}`, k))) return -1;
  if (p.remoteOnly && !job.remote) return -1;
  if (job.postedAt && p.maxAgeDays) {
    const age = (Date.now() - new Date(job.postedAt).getTime()) / 864e5;
    if (age > p.maxAgeDays) return -1;
  }

  let score = 0;
  let roleScore = 0;
  for (const role of p.targetRoles) {
    if (title.includes(lc(role))) { roleScore = 50; break; }
    const tokens = lc(role).split(/\s+/).filter((t) => !STOP.has(t));
    const hit = tokens.filter((t) => hasWord(title, t)).length;
    roleScore = Math.max(roleScore, tokens.length ? (hit / tokens.length) * 35 : 0);
  }
  score += roleScore;

  const hits = p.skills.filter((k) => hasWord(text, k)).length;
  score += Math.min(40, (hits / Math.max(1, Math.min(p.skills.length, 8))) * 40);

  const locOk = !p.locations.length || p.locations.some((l) => (/remote/i.test(l) ? job.remote : loc.includes(lc(l))));
  if (locOk) score += 10;
  else if (p.strictLocation) return -1;

  return Math.round(score);
}

// ---------- 1. Search ----------
export async function search(profile, log = console.log) {
  if (!profile.targetRoles.length && !profile.skills.length) throw new Error('Add targetRoles and/or skills to profile.json');
  log('Fetching jobs...');
  const jobs = await fetchAllJobs(profile, log);
  let added = 0, filtered = 0;
  for (const j of jobs) {
    if (!j.title || !j.url) continue;
    j.tags = (j.tags || []).filter(Boolean).map(String);
    j.heuristic = heuristicScore(j, profile);
    if (j.heuristic < 25) { filtered++; continue; }
    j.uid = `${j.source}:${j.externalId}`;
    j.dedupe = `${lc(j.company).replace(/[^a-z0-9]/g, '')}|${lc(j.title).replace(/[^a-z0-9]/g, '')}`;
    if (db.insertJob(j)) added++;
  }
  log(`Found ${jobs.length} jobs, ${filtered} filtered out as irrelevant, ${added} new relevant jobs saved.`);
  return added;
}

// ---------- 2. Rank with LLM ----------
function candidateContext(profile, resume) {
  const prefs = {
    targetRoles: profile.targetRoles, skills: profile.skills, seniority: profile.seniority,
    locations: profile.locations, remoteOnly: profile.remoteOnly, currentLocation: profile.currentLocation,
    minSalary: profile.minSalary, workAuthorization: profile.workAuthorization,
    noticePeriod: profile.noticePeriod, notes: profile.extraNotes,
  };
  return `CANDIDATE PREFERENCES:\n${JSON.stringify(prefs, null, 2)}\n\nCANDIDATE RESUME:\n${resume.slice(0, 15000)}`;
}

const jobText = (j, max = 7000) =>
  `JOB #${j.id}\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location}\nSalary: ${j.salary || 'n/a'}\n` +
  `Tags: ${j.tags}\nURL: ${j.url}\n\nDescription:\n${String(j.description).slice(0, max)}`;

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

export async function rank(profile, { limit } = {}, log = console.log) {
  const resume = await readResumeText(profile.resumePath);
  const ctx = candidateContext(profile, resume);
  const jobs = db.query(`SELECT * FROM jobs WHERE status = 'new' ORDER BY heuristic DESC LIMIT ?`, limit || profile.maxJobsToRank);
  log(`Ranking ${jobs.length} jobs with the LLM...`);
  let fatal = false;
  await pool(jobs, 3, async (j) => {
    if (fatal) return;
    try {
      const a = await chatJSON([
        { role: 'system', content: 'You are a senior technical recruiter. Evaluate candidate-job fit honestly and strictly. Consider hard requirements (years of experience, must-have skills, location/visa/timezone restrictions such as "US only"). Respond with JSON only.' },
        { role: 'user', content: `${ctx}\n\n---\n${jobText(j)}\n\n---\nReturn JSON: {"score": 0-100 overall fit (70+ = strong, worth applying), "verdict": "apply"|"maybe"|"skip", "summary": "one line", "matchingSkills": [], "missingSkills": [], "redFlags": ["e.g. location restriction, seniority mismatch"], "reasons": ["max 3 short bullets"]}` },
      ], { temperature: 0.1 });
      const score = Math.max(0, Math.min(100, Math.round(Number(a.score) || 0)));
      db.update(j.id, { score, analysis: JSON.stringify(a), status: a.verdict === 'skip' || score < 40 ? 'skipped' : 'ranked' });
      log(`  [${String(score).padStart(3)}] #${j.id} ${j.title} @ ${j.company} - ${a.summary || ''}`);
    } catch (e) {
      if (fatal) return;
      log(`  ! #${j.id} failed: ${e.message}`);
      if (/non-API response|No LLM API key|LLM error 40[13]/.test(e.message)) fatal = true;
    }
  });
}

// ---------- 3. Prepare tailored application kit ----------
export async function prepare(profile, ids, log = console.log) {
  const resume = await readResumeText(profile.resumePath);
  const ctx = candidateContext(profile, resume);
  for (const id of ids) {
    const j = db.getJob(id);
    log(`Preparing application for #${j.id} ${j.title} @ ${j.company}...`);
    const k = await chatJSON([
      { role: 'system', content: 'You are an expert career coach and resume writer. Tailor application materials to the job. NEVER invent experience, employers, degrees, metrics or skills the candidate does not have; only reframe and emphasize what is in the resume. Write in a natural, confident, non-generic human tone (no "I am thrilled", no clichés). Respond with JSON only.' },
      { role: 'user', content: `${ctx}\n\nCandidate contact: ${profile.name} | ${profile.email} | ${profile.phone} | ${profile.linkedin} | ${profile.github} ${profile.portfolio}\n\n---\n${jobText(j, 9000)}\n\n---\nReturn JSON:\n{"coverLetter": "max 250 words, plain text, addressed to Hiring Team at the company, ends with candidate name",\n "tailoredSummary": "3-line professional summary for the top of the resume targeted to this job",\n "resumeBulletRewrites": [{"original": "bullet from resume", "improved": "rewritten to mirror job keywords, still truthful"}],\n "atsKeywords": ["important keywords from the job the resume should contain"],\n "missingKeywords": ["job keywords absent from resume - only add if candidate genuinely has them"],\n "recruiterMessage": "LinkedIn connection note to recruiter/hiring manager, max 300 characters",\n "whyThisCompany": "2-3 sentence answer",\n "screeningAnswers": [{"question": "likely application form question", "answer": "answer"}],\n "interviewTopics": ["topics to revise for this role"]}` },
    ], { temperature: 0.5 });

    const folder = path.join(OUTPUT_DIR, `${j.id}-${slug(j.company)}-${slug(j.title)}`);
    fs.mkdirSync(folder, { recursive: true });
    const list = (a) => (a || []).map((x) => `- ${x}`).join('\n');
    const md = `# ${j.title} @ ${j.company}

**Apply here:** ${j.url}
**Location:** ${j.location} | **Salary:** ${j.salary || 'n/a'} | **Fit score:** ${j.score ?? 'n/a'} | **Source:** ${j.source}

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
    fs.writeFileSync(path.join(folder, 'application.md'), md);
    fs.writeFileSync(path.join(folder, 'cover-letter.txt'), k.coverLetter || '');
    fs.writeFileSync(path.join(folder, 'job-description.txt'), jobText(j, 100000));
    db.update(j.id, { status: 'ready', folder });
    log(`  -> ${path.join(folder, 'application.md')}`);
  }
}

export function topReadyIds(profile, n) {
  return db.query(`SELECT id FROM jobs WHERE status = 'ranked' AND score >= ? ORDER BY score DESC LIMIT ?`,
    profile.minScoreToPrepare, n).map((r) => r.id);
}

// ---------- 4. Follow-ups ----------
export async function followups(profile, days, log = console.log) {
  const jobs = db.query(`SELECT * FROM jobs WHERE status = 'applied' AND applied_at <= datetime('now', ?) ORDER BY applied_at`, `-${days} days`);
  if (!jobs.length) return log(`No applications older than ${days} days awaiting a reply.`);
  for (const j of jobs) {
    const r = await chatJSON([
      { role: 'system', content: 'You write short, polite, specific job application follow-up messages. JSON only.' },
      { role: 'user', content: `Candidate: ${profile.name}. Applied on ${j.applied_at} for "${j.title}" at ${j.company}. Fit notes: ${j.analysis || ''}\nReturn {"subject": "...", "email": "max 120 words", "linkedin": "max 300 chars"}` },
    ]);
    log(`\n=== #${j.id} ${j.title} @ ${j.company} (applied ${j.applied_at}) ===\nSubject: ${r.subject}\n\n${r.email}\n\nLinkedIn: ${r.linkedin}`);
  }
}
