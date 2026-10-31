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
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const queries = (profile) => (profile.targetRoles.length ? profile.targetRoles : profile.skills.slice(0, 3));

const SOURCES = {
  async remotive(profile) {
    const out = [];
    for (const q of queries(profile)) {
      const data = await getJSON(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=100`);
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

  // Optional, needs free keys from https://developer.adzuna.com (great for India/UK/US/EU on-site jobs)
  async adzuna(profile) {
    const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = process.env;
    if (!id || !key) return null;
    const out = [];
    const wheres = profile.locations.filter((l) => !/remote/i.test(l));
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

export async function fetchAllJobs(profile, log = console.log) {
  const enabled = profile.sources.filter((s) => SOURCES[s]);
  const results = await Promise.allSettled(enabled.map((s) => SOURCES[s](profile)));
  const jobs = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') log(`  ! ${enabled[i]}: ${r.reason.message}`);
    else if (r.value === null) log(`  - ${enabled[i]}: skipped (no API keys configured)`);
    else {
      log(`  + ${enabled[i]}: ${r.value.length} jobs`);
      jobs.push(...r.value);
    }
  });
  return jobs;
}
