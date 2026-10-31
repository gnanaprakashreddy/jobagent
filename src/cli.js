#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ROOT, PROFILE_PATH } from './paths.js';
import { loadProfile } from './config.js';
import { llmInfo } from './llm.js';
import * as agent from './agent.js';
import * as db from './db.js';

const HELP = `Job Agent - find, rank and prepare job applications fast

Usage: node src/cli.js <command> [options]

  init                      Create profile.json and .env from templates
  run [--top N]             Daily pipeline: search -> rank -> prepare top N kits (default: autoPrepareTop)
  search                    Fetch new jobs from all sources and pre-filter them
  rank [--limit N]          Score unranked jobs against your resume with the LLM
  prepare <id...>|--top N   Generate tailored cover letter, resume tweaks, recruiter msg, answers
  list [--status S] [--min SCORE] [--limit N] [--all]
                            Show jobs (default: ranked/ready/opened, best first)
  show <id>                 Show job details and fit analysis
  open <id>                 Open the apply link (and application kit) and mark as opened
  mark <id> <status> [--note TEXT]
                            Statuses: ${db.STATUSES.join(', ')}
  followups [--days N]      Draft follow-ups for applications with no reply after N days (default 7)
  dashboard                 Build the static HTML dashboard in site/index.html
  stats                     Pipeline summary
`;

function openTarget(target) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function printTable(rows) {
  if (!rows.length) return console.log('No jobs found.');
  for (const r of rows) {
    const score = r.score == null ? `~${r.heuristic}` : String(r.score);
    console.log(`#${String(r.id).padEnd(5)} ${score.padStart(4)}  ${r.status.padEnd(9)} ${`${r.title} @ ${r.company}`.slice(0, 70).padEnd(70)} ${String(r.location || '').slice(0, 35)}`);
  }
  console.log('\nScore: LLM fit 0-100 (~N = keyword pre-score, not yet ranked)');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values: o, positionals: pos } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      top: { type: 'string' }, limit: { type: 'string' }, status: { type: 'string' },
      min: { type: 'string' }, all: { type: 'boolean' }, note: { type: 'string' }, days: { type: 'string' },
    },
  });

  switch (cmd) {
    case 'init': {
      for (const [src, dst] of [['profile.example.json', PROFILE_PATH], ['.env.example', path.join(ROOT, '.env')]]) {
        if (fs.existsSync(dst)) console.log(`exists: ${dst}`);
        else { fs.copyFileSync(path.join(ROOT, src), dst); console.log(`created: ${dst}`); }
      }
      console.log('\nNext: edit profile.json (roles, skills, resumePath), optionally .env, then run: node src/cli.js run');
      break;
    }
    case 'search': await agent.search(loadProfile()); break;
    case 'rank': await agent.rank(loadProfile(), { limit: o.limit && Number(o.limit) }); break;
    case 'prepare': {
      const p = loadProfile();
      const ids = pos.length ? pos : agent.topReadyIds(p, Number(o.top || p.autoPrepareTop));
      if (!ids.length) console.log(`No ranked jobs with score >= ${p.minScoreToPrepare}. Run "rank" first or pass ids.`);
      await agent.prepare(p, ids);
      break;
    }
    case 'run': {
      const p = loadProfile();
      console.log(`LLM: ${llmInfo().model} @ ${llmInfo().baseUrl}\n`);
      await agent.search(p);
      await agent.rank(p);
      const ids = agent.topReadyIds(p, Number(o.top ?? p.autoPrepareTop));
      if (ids.length) await agent.prepare(p, ids);
      console.log('\nBest matches:');
      printTable(db.query(`SELECT * FROM jobs WHERE status IN ('ranked','ready') ORDER BY score DESC LIMIT 15`));
      console.log('\nNext: "open <id>" to apply, then "mark <id> applied".');
      break;
    }
    case 'list': {
      const where = [];
      const params = [];
      if (o.status) { where.push('status = ?'); params.push(o.status); }
      else if (!o.all) where.push(`status IN ('ranked','ready','opened')`);
      if (o.min) { where.push('score >= ?'); params.push(Number(o.min)); }
      printTable(db.query(`SELECT * FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY score IS NULL, score DESC, heuristic DESC LIMIT ?`, ...params, Number(o.limit || 30)));
      break;
    }
    case 'show': {
      const j = db.getJob(pos[0]);
      const a = j.analysis ? JSON.parse(j.analysis) : {};
      console.log(`#${j.id} ${j.title} @ ${j.company}\n${j.location} | ${j.salary || 'salary n/a'} | ${j.source} | status: ${j.status}\n${j.url}\n`);
      if (j.score != null) {
        console.log(`Fit: ${j.score}/100 (${a.verdict}) - ${a.summary}`);
        console.log(`Matching: ${(a.matchingSkills || []).join(', ')}\nMissing:  ${(a.missingSkills || []).join(', ')}`);
        console.log(`Red flags: ${(a.redFlags || []).join('; ') || 'none'}\nWhy: ${(a.reasons || []).join(' | ')}`);
      }
      if (j.folder) console.log(`\nApplication kit: ${j.folder}`);
      if (j.notes) console.log(`Notes: ${j.notes}`);
      console.log(`\n${String(j.description).slice(0, 1500)}${j.description.length > 1500 ? '...' : ''}`);
      break;
    }
    case 'open': {
      const j = db.getJob(pos[0]);
      openTarget(j.url);
      if (j.folder) openTarget(path.join(j.folder, 'application.md'));
      if (['new', 'ranked', 'ready', 'skipped'].includes(j.status)) db.update(j.id, { status: 'opened' });
      console.log(`Opened ${j.url}\nAfter submitting: node src/cli.js mark ${j.id} applied`);
      break;
    }
    case 'mark': {
      const [id, status] = pos;
      if (!db.STATUSES.includes(status)) throw new Error(`Status must be one of: ${db.STATUSES.join(', ')}`);
      const fields = { status };
      if (status === 'applied') fields.applied_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
      if (o.note) fields.notes = o.note;
      db.update(id, fields);
      console.log(`#${id} -> ${status}`);
      break;
    }
    case 'dashboard': {
      const { buildDashboard } = await import('./dashboard.js');
      console.log(`Dashboard written to ${buildDashboard()}`);
      break;
    }
    case 'followups': await agent.followups(loadProfile(), Number(o.days || 7)); break;
    case 'stats': {
      for (const r of db.query('SELECT status, COUNT(*) n, ROUND(AVG(score)) avg FROM jobs GROUP BY status ORDER BY n DESC')) {
        console.log(`${r.status.padEnd(10)} ${String(r.n).padStart(5)}${r.avg != null ? `   avg fit ${r.avg}` : ''}`);
      }
      const [w] = db.query(`SELECT COUNT(*) n FROM jobs WHERE applied_at >= datetime('now','-7 days')`);
      console.log(`\nApplied in the last 7 days: ${w.n}`);
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
