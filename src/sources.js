// Free/public job sources. Each returns normalized jobs:
// { source, externalId, title, company, location, url, description, tags[], salary, postedAt, remote }
const UA = { 'User-Agent': 'job-agent/1.0 (personal job search assistant)' };

async function getJSON(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export function stripHtml(html = '') {
  return String(html)
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const clean = (s) => (s == null ? s : stripHtml(String(s)).replace(/\s+/g, ' ').trim());

const queries = (profile) => (profile.targetRoles?.length ? profile.targetRoles : (profile.skills || []).slice(0, 3));

const SOURCES = {
  async remotive(profile) {
    const out = [];
    const qs = queries(profile);
    for (const q of qs.length ? qs : ['']) {
      const data = await getJSON(`https://remotive.com/api/remote-jobs?limit=100${q ? `&search=${encodeURIComponent(q)}` : ''}`);
      for (const j of data.jobs || []) {
        out.push({
          source: 'remotive', externalId: j.id, title: j.title, company: j.company_name,
          location: `Remote (${j.candidate_required_location || 'Anywhere'})`, url: j.url,
          description: stripHtml(j.description), tags: j.tags || [], salary: j.salary, postedAt: j.publication_date, remote: true,
        });
      }
    }
    return out;
  },

  async remoteok() {
    const data = await getJSON('https://remoteok.com/api');
    return data.filter((j) => j.id && j.position).map((j) => ({
      source: 'remoteok', externalId: j.id, title: j.position, company: j.company,
      location: `Remote (${j.location || 'Anywhere'})`, url: j.url || j.apply_url,
      description: stripHtml(j.description), tags: j.tags || [],
      salary: j.salary_min ? `${j.salary_min}-${j.salary_max} USD` : '', postedAt: j.date, remote: true,
    }));
  },

  async arbeitnow() {
    const out = [];
    for (let page = 1; page <= 3; page++) {
      const data = await getJSON(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      for (const j of data.data || []) {
        out.push({
          source: 'arbeitnow', externalId: j.slug, title: j.title, company: j.company_name,
          location: j.remote ? `Remote / ${j.location}` : j.location, url: j.url,
          description: stripHtml(j.description), tags: [...(j.tags || []), ...(j.job_types || [])],
          salary: '', postedAt: new Date(j.created_at * 1000).toISOString(), remote: !!j.remote,
        });
      }
      if (!data.links?.next) break;
    }
    return out;
  },

  async themuse() {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const data = await getJSON(`https://www.themuse.com/api/public/jobs?page=${page}&descending=true`);
      for (const j of data.results || []) {
        const loc = (j.locations || []).map((l) => l.name).join('; ');
        out.push({
          source: 'themuse', externalId: j.id, title: j.name, company: j.company?.name,
          location: loc, url: j.refs?.landing_page, description: stripHtml(j.contents),
          tags: [...(j.categories || []), ...(j.levels || [])].map((x) => x.name),
          salary: '', postedAt: j.publication_date, remote: /remote|flexible/i.test(loc),
        });
      }
    }
    return out;
  },

  async jobicy() {
    const data = await getJSON('https://jobicy.com/api/v2/remote-jobs?count=100');
    return (data.jobs || []).map((j) => ({
      source: 'jobicy', externalId: j.id, title: stripHtml(j.jobTitle), company: j.companyName,
      location: `Remote (${j.jobGeo || 'Anywhere'})`, url: j.url, description: stripHtml(j.jobDescription || j.jobExcerpt),
      tags: [...(j.jobIndustry || []), ...(j.jobType || []), j.jobLevel].filter(Boolean).map(stripHtml),
      salary: j.salaryMin ? `${j.salaryMin}-${j.salaryMax} ${j.salaryCurrency || ''}`.trim() : '', postedAt: j.pubDate, remote: true,
    }));
  },

  async himalayas() {
    const out = [];
    for (let offset = 0; offset < 200; offset += 20) {
      const data = await getJSON(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`);
      for (const j of data.jobs || []) {
        out.push({
          source: 'himalayas', externalId: j.guid, title: j.title, company: j.companyName,
          location: `Remote (${(j.locationRestrictions || []).join(', ') || 'Anywhere'})`, url: j.applicationLink || j.guid,
          description: stripHtml(j.description || j.excerpt), tags: [...(j.categories || []), ...(j.seniority || [])],
          salary: j.minSalary ? `${j.minSalary}-${j.maxSalary} ${j.currency || ''}`.trim() : '',
          postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : '', remote: true,
        });
      }
      if (!data.jobs?.length) break;
    }
    return out;
  },

  // Optional, needs free keys from https://developer.adzuna.com (great for India/UK/US/EU on-site jobs)
  async adzuna(profile) {
    const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = process.env;
    if (!id || !key) return null;
    const out = [];
    const wheres = (profile.locations || []).filter((l) => !/remote/i.test(l));
    for (const q of queries(profile)) {
      for (const where of wheres.length ? wheres : ['']) {
        const url = `https://api.adzuna.com/v1/api/jobs/${profile.adzunaCountry}/search/1?app_id=${id}&app_key=${key}` +
          `&results_per_page=50&max_days_old=${profile.maxAgeDays}&what=${encodeURIComponent(q)}` +
          (where ? `&where=${encodeURIComponent(where)}` : '');
        const data = await getJSON(url);
        for (const j of data.results || []) {
          out.push({
            source: 'adzuna', externalId: j.id, title: stripHtml(j.title), company: j.company?.display_name,
            location: j.location?.display_name, url: j.redirect_url, description: stripHtml(j.description),
            tags: [j.category?.label].filter(Boolean),
            salary: j.salary_min ? `${Math.round(j.salary_min)}-${Math.round(j.salary_max)}` : '', postedAt: j.created,
            remote: /remote/i.test(j.title + j.description),
          });
        }
      }
    }
    return out;
  },
};

export const ALL_SOURCES = Object.keys(SOURCES);

const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Fetch, normalize and de-duplicate (same company + title across boards).
export async function fetchAllJobs(profile, log = console.log) {
  const enabled = (profile.sources || ALL_SOURCES).filter((s) => SOURCES[s]);
  const results = await Promise.allSettled(enabled.map((s) => SOURCES[s](profile)));
  const jobs = [];
  const seen = new Set();
  results.forEach((r, i) => {
    if (r.status === 'rejected') return log(`  ! ${enabled[i]}: ${r.reason.message}`);
    if (r.value === null) return log(`  - ${enabled[i]}: skipped (no API keys configured)`);
    log(`  + ${enabled[i]}: ${r.value.length} jobs`);
    for (const j of r.value) {
      j.title = clean(j.title);
      j.company = clean(j.company);
      if (typeof j.location === 'string') j.location = clean(j.location);
      if (/<[a-z][^>]*>|&[#a-z0-9]+;/i.test(j.description || '')) j.description = stripHtml(j.description);
      if (!j.title || !/^https?:\/\//i.test(j.url || '')) continue;
      j.uid = `${j.source}:${j.externalId}`;
      j.dedupe = `${key(j.company)}|${key(j.title)}`;
      if (seen.has(j.dedupe)) continue;
      seen.add(j.dedupe);
      j.tags = (j.tags || []).filter(Boolean).map(String);
      j.company = j.company || 'Unknown';
      jobs.push(j);
    }
  });
  return jobs;
}
