import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { fetchAllJobs, ALL_SOURCES } from './sources.js';

// Builds the static site for GitHub Pages: the web app + a public jobs.json feed.
// The feed contains only public job postings, never personal data.
export async function buildSite(log = console.log) {
  const env = process.env;
  const feedProfile = {
    targetRoles: (env.FEED_QUERIES || 'software engineer,developer,data,devops,product manager,designer')
      .split(',').map((s) => s.trim()).filter(Boolean),
    locations: (env.FEED_LOCATIONS || '').split(',').map((s) => s.trim()).filter(Boolean),
    sources: env.FEED_SOURCES ? env.FEED_SOURCES.split(',').map((s) => s.trim()) : ALL_SOURCES,
    adzunaCountry: env.ADZUNA_COUNTRY || 'in',
    maxAgeDays: Number(env.FEED_MAX_AGE_DAYS || 30),
  };
  log(`Building job feed (queries: ${feedProfile.targetRoles.join(', ')})`);
  const cutoff = Date.now() - feedProfile.maxAgeDays * 864e5;
  const jobs = (await fetchAllJobs(feedProfile, log))
    .filter((j) => !j.postedAt || new Date(j.postedAt).getTime() >= cutoff)
    .map((j) => ({
      id: j.uid, source: j.source, title: j.title, company: j.company, location: j.location || '',
      url: j.url, description: String(j.description || '').slice(0, 5000), tags: j.tags.slice(0, 12),
      salary: j.salary || '', postedAt: j.postedAt || '', remote: !!j.remote,
    }))
    .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));

  const out = path.join(ROOT, 'site');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'web'), out, { recursive: true });
  fs.writeFileSync(path.join(out, 'jobs.json'), JSON.stringify({ updatedAt: new Date().toISOString(), count: jobs.length, jobs }));
  log(`Wrote ${jobs.length} jobs to ${path.join(out, 'jobs.json')}`);
  return out;
}
