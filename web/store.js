import { DEFAULT_PROFILE } from './match.js';

const KEY = 'jobagent:v1';
const GIST_FILE = 'jobagent-state.json';
const GIST_DESC = 'Job Agent state (private, do not share)';

function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* corrupt -> reset */ }
  const st = {
    profile: { ...DEFAULT_PROFILE, ...s.profile },
    resumeText: s.resumeText || '',
    llm: { preset: 'gemini', baseUrl: '', model: '', apiKey: '', ...s.llm },
    sync: { token: '', gistId: '', lastSync: '', ...s.sync },
    jobs: s.jobs || {},
    updatedAt: s.updatedAt || 0,
  };
  // Drop old AI scores for jobs you never acted on, to keep storage small.
  const cutoff = Date.now() - 45 * 864e5;
  for (const [id, r] of Object.entries(st.jobs)) {
    if (!r.status && !r.kit && r.analyzedAt && new Date(r.analyzedAt).getTime() < cutoff) delete st.jobs[id];
  }
  return st;
}

export const state = load();
const listeners = new Set();
export const onSyncChange = (fn) => listeners.add(fn);
let syncMsg = '';
export const syncStatus = () => syncMsg;
const setSync = (m) => { syncMsg = m; listeners.forEach((fn) => fn(m)); };

let timer;
export function save({ sync = true } = {}) {
  state.updatedAt = Date.now();
  persist();
  if (sync && state.sync.token) {
    clearTimeout(timer);
    timer = setTimeout(() => pushSync().catch((e) => setSync(`Sync failed: ${e.message}`)), 2500);
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert(`Could not save locally (storage full?): ${e.message}`);
  }
}

export function rec(id) {
  return (state.jobs[id] ||= {});
}

// ---------- Cross-device sync via a secret GitHub Gist ----------
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${state.sync.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return res.json();
}

const syncPayload = () => JSON.stringify({ profile: state.profile, resumeText: state.resumeText, jobs: state.jobs, updatedAt: state.updatedAt });

async function findGist() {
  if (state.sync.gistId) return state.sync.gistId;
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const g = list.find((x) => x.files?.[GIST_FILE]);
    if (g) return (state.sync.gistId = g.id);
    if (list.length < 100) break;
  }
  return '';
}

export async function pushSync() {
  if (!state.sync.token) return;
  setSync('Syncing…');
  const files = { [GIST_FILE]: { content: syncPayload() } };
  await findGist();
  if (state.sync.gistId) await gh(`/gists/${state.sync.gistId}`, { method: 'PATCH', body: JSON.stringify({ files }) });
  else state.sync.gistId = (await gh('/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESC, public: false, files }) })).id;
  state.sync.lastSync = new Date().toISOString();
  persist();
  setSync(`Synced ${new Date().toLocaleTimeString()}`);
}

// Returns true if newer remote data replaced local data.
export async function pullSync() {
  if (!state.sync.token) return false;
  setSync('Checking cloud…');
  if (!(await findGist())) { setSync('No cloud copy yet'); return false; }
  const g = await gh(`/gists/${state.sync.gistId}`);
  const f = g.files?.[GIST_FILE];
  if (!f) return false;
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  const remote = JSON.parse(text);
  persist();
  if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
    Object.assign(state, {
      profile: { ...DEFAULT_PROFILE, ...remote.profile }, resumeText: remote.resumeText || '',
      jobs: remote.jobs || {}, updatedAt: remote.updatedAt,
    });
    persist();
    setSync(`Loaded cloud copy ${new Date().toLocaleTimeString()}`);
    return true;
  }
  setSync('Up to date');
  return false;
}

export function exportData() {
  return JSON.stringify({ profile: state.profile, resumeText: state.resumeText, jobs: state.jobs, updatedAt: state.updatedAt }, null, 2);
}

export function importData(json) {
  const d = JSON.parse(json);
  Object.assign(state, { profile: { ...DEFAULT_PROFILE, ...d.profile }, resumeText: d.resumeText || '', jobs: d.jobs || {} });
  save();
}

export function resetAll() {
  localStorage.removeItem(KEY);
  location.reload();
}
