import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './paths.js';

export const STATUSES = ['new', 'ranked', 'skipped', 'ready', 'opened', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'];

const db = new DatabaseSync(path.join(DATA_DIR, 'jobs.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE,
    dedupe TEXT,
    source TEXT, title TEXT, company TEXT, location TEXT, url TEXT,
    description TEXT, tags TEXT, salary TEXT, posted_at TEXT,
    found_at TEXT DEFAULT (datetime('now')),
    heuristic REAL DEFAULT 0,
    score INTEGER,
    analysis TEXT,
    status TEXT DEFAULT 'new',
    folder TEXT,
    applied_at TEXT,
    notes TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`);

export function insertJob(job) {
  if (db.prepare('SELECT 1 FROM jobs WHERE dedupe = ? OR uid = ?').get(job.dedupe, job.uid)) return false;
  db.prepare(
    `INSERT INTO jobs (uid, dedupe, source, title, company, location, url, description, tags, salary, posted_at, heuristic)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(job.uid, job.dedupe, job.source, job.title, job.company, job.location, job.url, job.description,
    job.tags.join(', '), job.salary || '', job.postedAt || '', job.heuristic);
  return true;
}

export function getJob(id) {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(Number(id));
  if (!j) throw new Error(`No job with id ${id}`);
  return j;
}

export function update(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), Number(id));
}

export function query(sql, ...params) {
  return db.prepare(sql).all(...params);
}
