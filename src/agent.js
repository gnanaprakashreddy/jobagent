import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './paths.js';
import { readResumeText } from './resume.js';
import { chatJSON } from './llm.js';
import { fetchAllJobs } from './sources.js';
import { heuristicScore, rankMessages, kitMessages, followupMessages, jobText, kitMarkdown } from '../web/match.js';
import * as db from './db.js';

export { heuristicScore };

const lc = (s) => String(s || '').toLowerCase();
const slug = (s) => lc(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const fromRow = (r) => ({ ...r, tags: String(r.tags || '').split(', ').filter(Boolean) });

// ---------- 1. Search ----------
export async function search(profile, log = console.log) {
  if (!profile.targetRoles.length && !profile.skills.length) throw new Error('Add targetRoles and/or skills to profile.json');
  log('Fetching jobs...');
  const jobs = await fetchAllJobs(profile, log);
  let added = 0, filtered = 0;
  for (const j of jobs) {
    j.heuristic = heuristicScore(j, profile);
    if (j.heuristic < 25) { filtered++; continue; }
    if (db.insertJob(j)) added++;
  }
  log(`Found ${jobs.length} jobs, ${filtered} filtered out as irrelevant, ${added} new relevant jobs saved.`);
  return added;
}

// ---------- 2. Rank with LLM ----------
async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

export async function rank(profile, { limit } = {}, log = console.log) {
  const resume = await readResumeText(profile.resumePath);
  const jobs = db.query(`SELECT * FROM jobs WHERE status = 'new' ORDER BY heuristic DESC LIMIT ?`, limit || profile.maxJobsToRank);
  log(`Ranking ${jobs.length} jobs with the LLM...`);
  let fatal = false;
  await pool(jobs, 3, async (j) => {
    if (fatal) return;
    try {
      const a = await chatJSON(rankMessages(profile, resume, fromRow(j)), { temperature: 0.1 });
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
  for (const id of ids) {
    const j = db.getJob(id);
    log(`Preparing application for #${j.id} ${j.title} @ ${j.company}...`);
    const k = await chatJSON(kitMessages(profile, resume, fromRow(j)), { temperature: 0.5 });
    const folder = path.join(OUTPUT_DIR, `${j.id}-${slug(j.company)}-${slug(j.title)}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'application.md'), kitMarkdown(j, k, j.score));
    fs.writeFileSync(path.join(folder, 'cover-letter.txt'), k.coverLetter || '');
    fs.writeFileSync(path.join(folder, 'job-description.txt'), jobText(fromRow(j), 100000));
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
    const r = await chatJSON(followupMessages(profile, j, j.applied_at, j.analysis && JSON.parse(j.analysis)));
    log(`\n=== #${j.id} ${j.title} @ ${j.company} (applied ${j.applied_at}) ===\nSubject: ${r.subject}\n\n${r.email}\n\nLinkedIn: ${r.linkedin}`);
  }
}
