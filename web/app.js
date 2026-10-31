import { heuristicScore, rankMessages, kitMessages, followupMessages, profileFromResumeMessages, kitMarkdown } from './match.js';
import { state, save, rec, pushSync, pullSync, onSyncChange, syncStatus, exportData, importData, resetAll } from './store.js';
import { PRESETS, chatJSON, llmReady, llmConfig } from './llm.js';
import { extractResume } from './resume.js';

const app = document.getElementById('app');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const daysSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
const ago = (d) => {
  if (!d) return '';
  const n = daysSince(d);
  return Number.isNaN(n) ? '' : n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
};
const TRACK = ['saved', 'opened', 'applied', 'interview', 'offer', 'rejected'];
const LABEL = { saved: '⭐ Saved', opened: '↗ Opened', applied: '📨 Applied', interview: '🎤 Interview', offer: '🎉 Offer', rejected: '✖ Rejected', dismissed: '🚫 Hidden' };

let feed = { jobs: [], updatedAt: null };
let feedError = '';
let byId = new Map();
const ui = { q: '', min: 30, remote: false, source: '', sort: 'match', showHidden: false, limit: 50, rankN: 15, ranking: null };
const copies = [];

// ---------- helpers ----------
function toast(msg, ms = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}
const copyBtn = (text) => (text ? `<button class="small" data-act="copy" data-i="${copies.push(String(text)) - 1}">Copy</button>` : '');
const jobOf = (id) => byId.get(id) || state.jobs[id]?.job;
function snapshot(j, withDesc) {
  const { description, ...rest } = j;
  return withDesc ? { ...rest, description: String(description || '').slice(0, 5000) } : rest;
}
function setStatus(id, status) {
  const r = rec(id);
  const j = jobOf(id);
  r.status = status || undefined;
  r.statusAt = new Date().toISOString();
  if (status === 'applied' && !r.appliedAt) r.appliedAt = r.statusAt;
  if (j) r.job = snapshot(j, true);
  save();
}
async function pool(items, size, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: size }, async () => { while (q.length) await fn(q.shift()); }));
}
function download(name, text, type = 'text/markdown') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}
function scoreBadge(r, h) {
  if (r?.score != null) {
    const c = r.score >= 75 ? 's-hi' : r.score >= 55 ? 's-mid' : 's-lo';
    return `<div class="score ${c}" title="AI fit score">${r.score}<small>AI fit</small></div>`;
  }
  return `<div class="score s-kw" title="Keyword match with your skills & roles (not AI-ranked yet)">${h}<small>match</small></div>`;
}

// ---------- data ----------
async function loadFeed() {
  const res = await fetch('jobs.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`jobs.json ${res.status}`);
  feed = await res.json();
  byId = new Map(feed.jobs.map((j) => [j.id, j]));
}

function computeJobs() {
  const p = state.profile;
  const q = ui.q.toLowerCase();
  const out = [];
  const hasProfile = !!(p.targetRoles?.length || p.skills?.length);
  for (const j of feed.jobs) {
    const r = state.jobs[j.id];
    if (!ui.showHidden && r?.status === 'dismissed') continue;
    if (ui.remote && !j.remote) continue;
    if (ui.source && j.source !== ui.source) continue;
    if (q && !`${j.title} ${j.company} ${j.location} ${(j.tags || []).join(' ')}`.toLowerCase().includes(q)) continue;
    const h = heuristicScore(j, p);
    if (h < 0) continue;
    const s = r?.score ?? h;
    if (s < ui.min && hasProfile) continue;
    out.push({ j, r, h, s });
  }
  out.sort(ui.sort === 'new'
    ? (a, b) => String(b.j.postedAt).localeCompare(String(a.j.postedAt))
    : (a, b) => b.s - a.s || (b.r?.score != null) - (a.r?.score != null));
  return out;
}

// ---------- views ----------
function setupChecklist() {
  const p = state.profile;
  const steps = [
    [!!state.resumeText, 'Add your resume', '#profile'],
    [p.targetRoles.length + p.skills.length > 0, 'Set target roles & skills (or auto-fill them from your resume)', '#profile'],
    [llmReady(), 'Connect a free AI provider (Gemini or Groq, 1 minute)', '#settings'],
  ];
  if (steps.every((s) => s[0])) return '';
  return `<div class="card banner"><b>Get started</b><ol class="steps">${steps.map(([ok, t, href]) =>
    `<li class="${ok ? 'done' : ''}">${ok ? '✅' : '⬜'} ${ok ? e(t) : `<a href="${href}">${e(t)}</a>`}</li>`).join('')}</ol>
    <span class="muted small">Your resume, profile and keys are stored only in this browser (optionally synced to your own private GitHub Gist).</span></div>`;
}

function jobCard({ j, r, h }) {
  const a = r?.analysis;
  const id = e(j.id);
  const st = r?.status;
  const applyBtn = st === 'opened'
    ? `<button class="primary" data-act="status" data-st="applied" data-id="${id}">✓ I applied</button>`
    : `<button class="primary" data-act="apply" data-id="${id}">Apply ↗</button>`;
  return `<div class="card job">
    ${scoreBadge(r, h)}
    <div>
      <div class="title" data-act="open" data-id="${id}">${e(j.title)}</div>
      <div class="muted small">${e(j.company)} · ${e(j.location)}${j.salary ? ` · ${e(j.salary)}` : ''}${j.postedAt ? ` · ${ago(j.postedAt)}` : ''} · ${e(j.source)}</div>
      ${a?.summary ? `<div>${e(a.summary)}</div>` : ''}
      ${a?.redFlags?.length ? `<div class="flags">⚠ ${e(a.redFlags.join('; '))}</div>` : ''}
      ${st ? `<span class="pill st">${LABEL[st] || e(st)}</span>` : ''}${r?.kit ? '<span class="pill">📝 kit ready</span>' : ''}
    </div>
    <div class="actions">
      ${applyBtn}
      <button data-act="open" data-id="${id}">Details</button>
      ${st === 'dismissed' ? `<button data-act="status" data-st="" data-id="${id}">Unhide</button>`
        : `<button data-act="status" data-st="dismissed" data-id="${id}" title="Not interested">Hide</button>`}
    </div>
  </div>`;
}

function renderJobList() {
  const el = document.getElementById('joblist');
  if (!el) return;
  const rows = computeJobs();
  const unranked = rows.filter((x) => x.r?.score == null).length;
  document.getElementById('jobcount').textContent =
    `${rows.length} matching jobs · ${rows.length - unranked} AI-ranked · feed updated ${feed.updatedAt ? ago(feed.updatedAt) : 'n/a'} (${feed.jobs.length} total)`;
  const btn = document.getElementById('rankbtn');
  if (btn) {
    btn.disabled = !!ui.ranking;
    btn.textContent = ui.ranking ? `Ranking ${ui.ranking.done}/${ui.ranking.total}…` : `✨ AI-rank top ${Math.min(ui.rankN, unranked)} unranked`;
  }
  el.innerHTML = rows.slice(0, ui.limit).map(jobCard).join('') +
    (rows.length > ui.limit ? `<button data-act="more">Show more (${rows.length - ui.limit} left)</button>` : '') +
    (rows.length ? '' : '<p class="muted">No jobs match these filters. Lower the minimum score, or broaden your roles/skills in Profile.</p>');
}

function renderJobs() {
  const sources = [...new Set(feed.jobs.map((j) => j.source))].sort();
  app.innerHTML = `${setupChecklist()}
    ${feedError ? `<div class="card flags">Could not load the job feed (${e(feedError)}). It is generated by the GitHub Action; run it once from the Actions tab.</div>` : ''}
    <div class="card">
      <div class="row">
        <input id="f-q" class="grow" placeholder="Search title, company, location, tech…" value="${e(ui.q)}">
        <select id="f-min" title="Minimum score">${[0, 30, 40, 50, 60, 70, 80].map((v) => `<option value="${v}" ${ui.min === v ? 'selected' : ''}>${v ? `${v}+ score` : 'Any score'}</option>`).join('')}</select>
        <select id="f-source"><option value="">All sources</option>${sources.map((s) => `<option ${ui.source === s ? 'selected' : ''}>${e(s)}</option>`).join('')}</select>
        <select id="f-sort"><option value="match">Best match</option><option value="new" ${ui.sort === 'new' ? 'selected' : ''}>Newest</option></select>
        <label class="inline"><input type="checkbox" id="f-remote" ${ui.remote ? 'checked' : ''}> Remote</label>
        <label class="inline"><input type="checkbox" id="f-hidden" ${ui.showHidden ? 'checked' : ''}> Show hidden</label>
      </div>
      <div class="row" style="margin-top:8px">
        <button id="rankbtn" class="primary" data-act="rank"></button>
        <span id="jobcount" class="muted small grow"></span>
      </div>
    </div>
    <div id="joblist"></div>`;
  renderJobList();
}

function renderTracker() {
  const tracked = Object.entries(state.jobs).filter(([, r]) => TRACK.includes(r.status));
  const applied = tracked.filter(([, r]) => r.appliedAt);
  const week = applied.filter(([, r]) => daysSince(r.appliedAt) < 7).length;
  const count = (s) => tracked.filter(([, r]) => r.status === s).length;
  app.innerHTML = `<h2>Application tracker</h2>
    <div class="stats">
      <div class="stat"><b>${week}</b>applied this week</div>
      <div class="stat"><b>${applied.length}</b>applied total</div>
      <div class="stat"><b>${count('interview')}</b>interviews</div>
      <div class="stat"><b>${count('offer')}</b>offers</div>
    </div>
    <p class="muted small">Tip: applying to 5–10 strong-fit jobs a day plus a short recruiter message is the fastest path to interviews. Follow up after 7 days.</p>
    <div class="board">${TRACK.map((s) => {
      const items = tracked.filter(([, r]) => r.status === s).sort((a, b) => String(b[1].statusAt).localeCompare(String(a[1].statusAt)));
      return `<div class="col"><h3>${LABEL[s]} (${items.length})</h3>${items.map(([id, r]) => {
        const j = jobOf(id) || { title: '(job removed)', company: '' };
        const due = s === 'applied' && r.appliedAt && daysSince(r.appliedAt) >= 7;
        return `<div class="card mini">
          <div class="title" data-act="open" data-id="${e(id)}">${e(j.title)}</div>
          <div class="muted small">${e(j.company)} · ${ago(r.appliedAt || r.statusAt)}${r.score != null ? ` · fit ${r.score}` : ''}</div>
          ${due ? `<button class="small" data-act="followup" data-id="${e(id)}">✉ Draft follow-up</button>` : ''}
        </div>`;
      }).join('') || '<p class="muted small">—</p>'}</div>`;
    }).join('')}</div>`;
}

function renderProfile() {
  const p = state.profile;
  const f = (id, label, val, ph = '') => `<div><label for="pf-${id}">${label}</label><input id="pf-${id}" value="${e(val)}" placeholder="${e(ph)}"></div>`;
  app.innerHTML = `<h2>Your profile</h2>
    <div class="card">
      <div class="section-head"><b>Resume</b><span class="muted small">Parsed in your browser, never uploaded to our servers</span></div>
      <div class="row" style="margin:8px 0">
        <input type="file" id="pf-file" accept=".pdf,.docx,.txt,.md">
        <button data-act="autofill" class="primary">✨ Auto-fill profile from resume</button>
      </div>
      <textarea id="pf-resume" rows="10" placeholder="Upload a PDF/DOCX above, or paste your resume text here">${e(state.resumeText)}</textarea>
    </div>
    <div class="card">
      <b>What you're looking for</b>
      <div class="grid2">
        ${f('roles', 'Target roles (comma-separated)', p.targetRoles.join(', '), 'Backend Developer, Software Engineer')}
        ${f('skills', 'Key skills', p.skills.join(', '), 'Node.js, Python, AWS')}
        ${f('locations', 'Locations (include "Remote" for remote jobs)', p.locations.join(', '), 'Remote, Bengaluru')}
        ${f('exclude', 'Exclude titles containing', p.excludeKeywords.join(', '), 'intern, principal')}
        ${f('seniority', 'Seniority', p.seniority, 'mid-level (3-5 years)')}
        ${f('salary', 'Minimum salary', p.minSalary, '18 LPA')}
        ${f('notice', 'Notice period', p.noticePeriod, '30 days')}
        ${f('auth', 'Work authorization', p.workAuthorization, 'Indian citizen, needs sponsorship abroad')}
        ${f('age', 'Ignore jobs older than (days)', p.maxAgeDays, '30')}
      </div>
      <div class="row" style="margin-top:10px">
        <label class="inline"><input type="checkbox" id="pf-remoteOnly" ${p.remoteOnly ? 'checked' : ''}> Remote only</label>
        <label class="inline"><input type="checkbox" id="pf-strict" ${p.strictLocation ? 'checked' : ''}> Hide jobs outside my locations</label>
      </div>
      <label for="pf-notes">Anything else the AI should know</label>
      <textarea id="pf-notes" rows="2" placeholder="Prefer product companies; open to relocation…">${e(p.extraNotes)}</textarea>
    </div>
    <div class="card">
      <b>Contact details</b> <span class="muted small">(used in cover letters)</span>
      <div class="grid2">
        ${f('name', 'Name', p.name)}${f('email', 'Email', p.email)}${f('phone', 'Phone', p.phone)}
        ${f('linkedin', 'LinkedIn', p.linkedin)}${f('github', 'GitHub', p.github)}${f('portfolio', 'Portfolio', p.portfolio)}
        ${f('city', 'Current location', p.currentLocation)}
      </div>
    </div>
    <button class="primary" data-act="saveprofile">Save profile</button>`;
}

function readProfileForm() {
  const v = (id) => document.getElementById(`pf-${id}`).value.trim();
  Object.assign(state.profile, {
    targetRoles: splitList(v('roles')), skills: splitList(v('skills')), locations: splitList(v('locations')),
    excludeKeywords: splitList(v('exclude')), seniority: v('seniority'), minSalary: v('salary'), noticePeriod: v('notice'),
    workAuthorization: v('auth'), maxAgeDays: Number(v('age')) || 30, extraNotes: v('notes'),
    remoteOnly: document.getElementById('pf-remoteOnly').checked, strictLocation: document.getElementById('pf-strict').checked,
    name: v('name'), email: v('email'), phone: v('phone'), linkedin: v('linkedin'), github: v('github'),
    portfolio: v('portfolio'), currentLocation: v('city'),
  });
  state.resumeText = document.getElementById('pf-resume').value.trim();
}

function renderSettings() {
  const preset = PRESETS[state.llm.preset] || PRESETS.custom;
  const cfg = llmConfig();
  app.innerHTML = `<h2>Settings</h2>
    <div class="card">
      <b>AI provider</b>
      <p class="muted small">Used for ranking jobs and writing your application kits. Calls go directly from your browser to the provider. The key is stored only on this device.</p>
      <div class="grid2">
        <div><label>Provider</label><select id="st-preset">${Object.entries(PRESETS).map(([k, v]) =>
          `<option value="${k}" ${state.llm.preset === k ? 'selected' : ''}>${e(v.label)}</option>`).join('')}</select></div>
        <div><label>API key ${preset.keyUrl ? `<a href="${e(preset.keyUrl)}" target="_blank" rel="noopener" class="small">(get one free ↗)</a>` : ''}</label>
          <input id="st-key" type="password" value="${e(state.llm.apiKey)}" placeholder="Paste key" autocomplete="off"></div>
        <div><label>Model</label><input id="st-model" value="${e(state.llm.model)}" placeholder="${e(preset.model)}"></div>
        <div><label>Base URL</label><input id="st-url" value="${e(state.llm.baseUrl)}" placeholder="${e(preset.baseUrl)}"></div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="primary" data-act="savellm">Save</button><button data-act="testllm">Test connection</button>
        <span class="muted small">Using ${e(cfg.model || '?')} @ ${e(cfg.baseUrl || '?')}</span>
      </div>
    </div>
    <div class="card">
      <b>Sync across devices (optional, free)</b>
      <p class="muted small">Stores your profile, resume text and tracker in a <i>secret</i> Gist in your own GitHub account so you can use the app on your phone and laptop.
      Create a <a href="https://github.com/settings/tokens/new?scopes=gist&description=Job%20Agent%20sync" target="_blank" rel="noopener">classic token with only the "gist" scope ↗</a> and paste it on each device. API keys are not synced.</p>
      <div class="row"><input id="st-token" type="password" class="grow" value="${e(state.sync.token)}" placeholder="ghp_…" autocomplete="off">
        <button class="primary" data-act="syncconnect">Connect & sync</button>
        ${state.sync.token ? '<button data-act="syncpull">Pull latest</button><button data-act="syncoff">Disconnect</button>' : ''}</div>
      <p class="muted small">${e(syncStatus() || (state.sync.lastSync ? `Last synced ${new Date(state.sync.lastSync).toLocaleString()}` : 'Not connected'))}</p>
    </div>
    <div class="card">
      <b>Your data</b>
      <div class="row" style="margin-top:8px">
        <button data-act="export">Export backup</button>
        <label class="inline"><input type="file" id="st-import" accept=".json" hidden><button data-act="import">Import backup</button></label>
        <button data-act="reset">Delete all local data</button>
      </div>
    </div>`;
}

function renderKit(id, k) {
  const sec = (title, text) => (text ? `<div class="section-head"><h3>${title}</h3>${copyBtn(text)}</div><div class="pre">${e(text)}</div>` : '');
  return `
    ${sec('Cover letter', k.coverLetter)}
    ${sec('Recruiter / hiring manager message', k.recruiterMessage)}
    ${sec('Tailored resume summary', k.tailoredSummary)}
    ${k.resumeBulletRewrites?.length ? `<h3>Resume bullet rewrites</h3>${k.resumeBulletRewrites.map((b) =>
      `<div class="pre"><span class="muted"><s>${e(b.original)}</s></span>\n→ ${e(b.improved)} ${copyBtn(b.improved)}</div>`).join('')}` : ''}
    ${k.atsKeywords?.length ? `<h3>ATS keywords</h3><div>${k.atsKeywords.map((x) => `<span class="pill">${e(x)}</span>`).join('')}</div>` : ''}
    ${k.missingKeywords?.length ? `<p class="small"><b>Missing from your resume</b> (add only if true): ${e(k.missingKeywords.join(', '))}</p>` : ''}
    ${sec('Why this company?', k.whyThisCompany)}
    ${k.screeningAnswers?.length ? `<h3>Screening answers</h3>${k.screeningAnswers.map((q) =>
      `<div class="pre"><b>${e(q.question)}</b>\n${e(q.answer)} ${copyBtn(q.answer)}</div>`).join('')}` : ''}
    ${k.interviewTopics?.length ? `<h3>Interview prep</h3><ul>${k.interviewTopics.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}
    <div class="row"><button data-act="downloadkit" data-id="${e(id)}">⬇ Download kit (.md)</button><button data-act="kit" data-id="${e(id)}">↻ Regenerate</button></div>`;
}

function openJob(id) {
  const j = jobOf(id);
  if (!j) return toast('This job is no longer in the feed.');
  const r = state.jobs[id] || {};
  const a = r.analysis;
  const eid = e(id);
  copies.length = 0;
  modalBody.innerHTML = `<button class="close" data-act="close">✕</button>
    <h2>${e(j.title)}</h2>
    <div class="muted">${e(j.company)} · ${e(j.location)}${j.salary ? ` · ${e(j.salary)}` : ''} · ${e(j.source)}${j.postedAt ? ` · posted ${ago(j.postedAt)}` : ''}</div>
    <div class="row" style="margin:10px 0">
      <a href="${e(safeUrl(j.url))}" target="_blank" rel="noopener" data-act="applylink" data-id="${eid}"><button class="primary">Open posting & apply ↗</button></a>
      <select data-change="status" data-id="${eid}"><option value="">— status —</option>${[...TRACK, 'dismissed'].map((s) =>
        `<option value="${s}" ${r.status === s ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
      ${r.appliedAt ? `<span class="muted small">applied ${ago(r.appliedAt)}</span>` : ''}
    </div>
    <div class="card">
      <div class="section-head"><b>AI fit analysis</b>${a ? `<button class="small" data-act="analyze" data-id="${eid}">↻</button>` : ''}</div>
      ${a ? `<p><b style="font-size:18px">${r.score}/100</b> · ${e(a.verdict || '')} — ${e(a.summary || '')}</p>
        ${a.matchingSkills?.length ? `<div class="small">✅ ${a.matchingSkills.map((x) => `<span class="pill">${e(x)}</span>`).join('')}</div>` : ''}
        ${a.missingSkills?.length ? `<div class="small">❌ ${a.missingSkills.map((x) => `<span class="pill">${e(x)}</span>`).join('')}</div>` : ''}
        ${a.redFlags?.length ? `<div class="flags">⚠ ${e(a.redFlags.join('; '))}</div>` : ''}
        ${a.reasons?.length ? `<ul class="small">${a.reasons.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}`
        : `<p class="muted">Not analyzed yet.</p><button class="primary" data-act="analyze" data-id="${eid}">✨ Analyze my fit</button>`}
    </div>
    <div class="card">
      <b>Application kit</b>
      ${r.kit ? renderKit(id, r.kit) : `<p class="muted">Cover letter, resume tweaks, recruiter message and screening answers tailored to this job.</p>
        <button class="primary" data-act="kit" data-id="${eid}">✨ Generate application kit</button>`}
    </div>
    <label>Notes</label><textarea data-change="notes" data-id="${eid}" rows="2" placeholder="Referral, recruiter name, interview date…">${e(r.notes || '')}</textarea>
    <h3>Job description</h3>
    <div class="pre desc">${j.description ? e(j.description) : 'Open the posting for the full description.'}</div>`;
  if (!modal.open) modal.showModal();
}

function render() {
  const view = (location.hash || '#jobs').slice(1);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  ({ jobs: renderJobs, tracker: renderTracker, profile: renderProfile, settings: renderSettings }[view] || renderJobs)();
}

// ---------- actions ----------
async function withBusy(btn, fn) {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  try {
    await fn();
  } catch (err) {
    toast(err.message, 7000);
  } finally {
    if (btn?.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

function requireAI() {
  if (!llmReady()) { toast('Connect an AI provider first (Settings).'); location.hash = '#settings'; return false; }
  if (!state.resumeText) { toast('Add your resume first (Profile).'); location.hash = '#profile'; return false; }
  return true;
}

async function analyze(id) {
  const j = jobOf(id);
  const a = await chatJSON(rankMessages(state.profile, state.resumeText, j), { temperature: 0.1 });
  const r = rec(id);
  r.score = Math.max(0, Math.min(100, Math.round(Number(a.score) || 0)));
  r.analysis = { verdict: a.verdict, summary: a.summary, matchingSkills: a.matchingSkills, missingSkills: a.missingSkills, redFlags: a.redFlags, reasons: a.reasons };
  r.analyzedAt = new Date().toISOString();
  if (!r.job) r.job = snapshot(j, false);
  save();
}

async function rankTop() {
  if (!requireAI()) return;
  const todo = computeJobs().filter((x) => x.r?.score == null).slice(0, ui.rankN);
  if (!todo.length) return toast('Everything shown is already ranked. Lower the minimum score to see more.');
  ui.ranking = { done: 0, total: todo.length };
  renderJobList();
  let failed = null;
  await pool(todo, 2, async ({ j }) => {
    if (failed) return;
    try { await analyze(j.id); } catch (err) { failed = err; }
    ui.ranking.done++;
    renderJobList();
  });
  ui.ranking = null;
  renderJobList();
  toast(failed ? failed.message : 'Ranking done. Best fits are at the top.', failed ? 8000 : 3500);
}

const actions = {
  async open(id) { openJob(id); },
  close() { modal.close(); },
  more() { ui.limit += 50; renderJobList(); },
  rank: rankTop,
  apply(id) {
    const j = jobOf(id);
    window.open(safeUrl(j.url), '_blank', 'noopener');
    if (!['applied', 'interview', 'offer', 'rejected'].includes(state.jobs[id]?.status)) setStatus(id, 'opened');
    renderJobList();
    toast('After submitting, click "✓ I applied" to track it.');
  },
  applylink(id) {
    if (!['applied', 'interview', 'offer', 'rejected'].includes(state.jobs[id]?.status)) setStatus(id, 'opened');
  },
  status(id, btn) {
    setStatus(id, btn.dataset.st);
    if (btn.dataset.st === 'applied') toast('Tracked as applied 🎉 Tip: send the recruiter message from the kit now.');
    render();
  },
  async analyze(id, btn) {
    if (!requireAI()) return modal.close();
    await withBusy(btn, async () => { await analyze(id); openJob(id); });
  },
  async kit(id, btn) {
    if (!requireAI()) return modal.close();
    await withBusy(btn, async () => {
      const j = jobOf(id);
      const k = await chatJSON(kitMessages(state.profile, state.resumeText, j), { temperature: 0.5 });
      const r = rec(id);
      r.kit = k;
      r.kitAt = new Date().toISOString();
      r.job = snapshot(j, true);
      if (!r.status) { r.status = 'saved'; r.statusAt = r.kitAt; }
      save();
      openJob(id);
    });
  },
  downloadkit(id) {
    const j = jobOf(id);
    const slug = `${j.company}-${j.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    download(`${slug}.md`, kitMarkdown(j, state.jobs[id].kit, state.jobs[id].score));
  },
  async copy(_, btn) {
    await navigator.clipboard.writeText(copies[Number(btn.dataset.i)]);
    toast('Copied');
  },
  async followup(id, btn) {
    if (!requireAI()) return;
    await withBusy(btn, async () => {
      const r = state.jobs[id];
      const f = await chatJSON(followupMessages(state.profile, jobOf(id), r.appliedAt, r.analysis));
      copies.length = 0;
      modalBody.innerHTML = `<button class="close" data-act="close">✕</button><h2>Follow-up: ${e(jobOf(id).title)}</h2>
        <div class="section-head"><h3>Email subject</h3>${copyBtn(f.subject)}</div><div class="pre">${e(f.subject)}</div>
        <div class="section-head"><h3>Email</h3>${copyBtn(f.email)}</div><div class="pre">${e(f.email)}</div>
        <div class="section-head"><h3>LinkedIn message</h3>${copyBtn(f.linkedin)}</div><div class="pre">${e(f.linkedin)}</div>`;
      modal.showModal();
    });
  },
  async autofill(_, btn) {
    readProfileForm();
    if (!state.resumeText) return toast('Upload or paste your resume first.');
    if (!llmReady()) { save(); toast('Connect an AI provider first (Settings).'); location.hash = '#settings'; return; }
    await withBusy(btn, async () => {
      const x = await chatJSON(profileFromResumeMessages(state.resumeText), { temperature: 0.2 });
      const p = state.profile;
      for (const k of ['name', 'email', 'phone', 'linkedin', 'github', 'currentLocation', 'seniority']) if (!p[k] && x[k]) p[k] = x[k];
      const merge = (a, b) => [...new Map([...a, ...(b || [])].map((s) => [String(s).toLowerCase(), String(s)])).values()];
      p.targetRoles = merge(p.targetRoles, x.targetRoles);
      p.skills = merge(p.skills, x.skills);
      save();
      renderProfile();
      toast('Profile filled from your resume. Review and save.');
    });
  },
  saveprofile() {
    readProfileForm();
    save();
    toast('Profile saved. Your job matches are updated.');
    location.hash = '#jobs';
  },
  savellm() {
    Object.assign(state.llm, {
      apiKey: document.getElementById('st-key').value.trim(),
      model: document.getElementById('st-model').value.trim(),
      baseUrl: document.getElementById('st-url').value.trim(),
    });
    save({ sync: false });
    renderSettings();
    toast('AI settings saved');
  },
  async testllm(_, btn) {
    actions.savellm();
    await withBusy(document.querySelector('[data-act="testllm"]') || btn, async () => {
      const r = await chatJSON([{ role: 'user', content: 'Reply with JSON: {"ok": true}' }]);
      toast(r.ok ? '✅ AI connection works!' : `Unexpected reply: ${JSON.stringify(r)}`);
    });
  },
  async syncconnect(_, btn) {
    state.sync.token = document.getElementById('st-token').value.trim();
    if (!state.sync.token) return toast('Paste a token first');
    save({ sync: false });
    await withBusy(btn, async () => {
      const pulled = await pullSync();
      if (!pulled) await pushSync();
      toast(pulled ? 'Loaded your data from the cloud' : 'Synced to your private Gist');
      render();
    });
  },
  async syncpull(_, btn) {
    await withBusy(btn, async () => { toast((await pullSync()) ? 'Loaded newer data from cloud' : 'Already up to date'); render(); });
  },
  syncoff() {
    state.sync = { token: '', gistId: '', lastSync: '' };
    save({ sync: false });
    renderSettings();
  },
  export() { download(`job-agent-backup-${new Date().toISOString().slice(0, 10)}.json`, exportData(), 'application/json'); },
  import() { document.getElementById('st-import').click(); },
  reset() { if (confirm('Delete your profile, resume and tracker from this browser? (Cloud copy is kept.)')) resetAll(); },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'A') ev.preventDefault();
  Promise.resolve(fn(el.dataset.id, el)).catch((err) => toast(err.message, 7000));
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.dataset.change === 'status') { setStatus(t.dataset.id, t.value); if ((location.hash || '#jobs') === '#jobs') renderJobList(); else render(); }
  if (t.dataset.change === 'notes') { rec(t.dataset.id).notes = t.value; save(); }
  if (t.id === 'st-preset') { Object.assign(state.llm, { preset: t.value, baseUrl: '', model: '' }); save({ sync: false }); renderSettings(); }
  if (t.id === 'pf-file' && t.files[0]) {
    try {
      toast('Reading resume…');
      document.getElementById('pf-resume').value = await extractResume(t.files[0]);
      readProfileForm();
      save();
      toast('Resume loaded. Click "Auto-fill profile from resume".');
    } catch (err) { toast(err.message, 7000); }
  }
  if (t.id === 'st-import' && t.files[0]) {
    try { importData(await t.files[0].text()); toast('Backup imported'); render(); } catch (err) { toast(`Import failed: ${err.message}`); }
  }
  if (['f-min', 'f-source', 'f-sort', 'f-remote', 'f-hidden'].includes(t.id)) {
    Object.assign(ui, {
      min: Number(document.getElementById('f-min').value), source: document.getElementById('f-source').value,
      sort: document.getElementById('f-sort').value, remote: document.getElementById('f-remote').checked,
      showHidden: document.getElementById('f-hidden').checked, limit: 50,
    });
    renderJobList();
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'f-q') { ui.q = ev.target.value; ui.limit = 50; clearTimeout(ui.qt); ui.qt = setTimeout(renderJobList, 150); }
});

modal.addEventListener('close', () => { if ((location.hash || '#jobs') === '#jobs') renderJobList(); else render(); });
window.addEventListener('hashchange', () => { if (modal.open) modal.close(); render(); window.scrollTo(0, 0); });

// ---------- start ----------
const syncEl = document.getElementById('sync');
onSyncChange((m) => (syncEl.textContent = m));
try { await loadFeed(); } catch (err) { feedError = err.message; }
render();
if (state.sync.token) pullSync().then((changed) => changed && render()).catch((err) => (syncEl.textContent = `Sync failed: ${err.message}`));
