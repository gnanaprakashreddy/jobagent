import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import * as db from './db.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Static dashboard for GitHub Pages. Deliberately excludes the resume, contact details and generated kits.
export function buildDashboard() {
  const rows = db.query(`SELECT id, title, company, location, url, salary, source, score, heuristic, status, analysis, posted_at, found_at, applied_at
    FROM jobs WHERE score IS NOT NULL OR status NOT IN ('new') ORDER BY score DESC, heuristic DESC LIMIT 500`);
  const jobs = rows.map((r) => {
    const a = r.analysis ? JSON.parse(r.analysis) : {};
    return { ...r, analysis: undefined, verdict: a.verdict, summary: a.summary, missing: a.missingSkills || [], flags: a.redFlags || [] };
  });
  const counts = db.query('SELECT status, COUNT(*) n FROM jobs GROUP BY status');
  const updated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Job Agent Dashboard</title>
<style>
:root{color-scheme:light dark;--b:#8884;--a:#2f81f7}
body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;max-width:1200px;margin:auto}
h1{margin:0 0 4px}small{opacity:.7}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
input,select{padding:6px 8px;border:1px solid var(--b);border-radius:6px;background:transparent;color:inherit}
.chips span{border:1px solid var(--b);border-radius:12px;padding:2px 8px;margin-right:4px;font-size:12px}
.card{border:1px solid var(--b);border-radius:8px;padding:10px 12px;margin:8px 0;display:grid;grid-template-columns:56px 1fr;gap:10px}
.score{font-size:22px;font-weight:700;text-align:center;border-radius:8px;padding:6px 0}
.hi{background:#2da44e33}.mid{background:#d2992233}.lo{background:#cf222e22}
a{color:var(--a);text-decoration:none}.t{font-weight:600;font-size:15px}
.meta{opacity:.75;font-size:12px}.flags{color:#cf222e;font-size:12px}.miss{font-size:12px;opacity:.8}
.st{font-size:11px;text-transform:uppercase;border:1px solid var(--b);border-radius:4px;padding:0 4px;margin-left:6px}
</style></head><body>
<h1>🚀 Job Agent</h1><small>Updated ${esc(updated)} · ${jobs.length} jobs</small>
<div class="chips" style="margin-top:8px">${counts.map((c) => `<span>${esc(c.status)}: ${c.n}</span>`).join('')}</div>
<div class="bar">
<input id="q" placeholder="Search title, company, location..." size="34">
<select id="s"><option value="">Active (ranked/ready/opened/applied/interview)</option><option value="*">All</option>
${db.STATUSES.map((s) => `<option>${s}</option>`).join('')}</select>
<select id="m"><option value="0">Any score</option><option value="60">60+</option><option value="70" selected>70+</option><option value="80">80+</option></select>
</div>
<div id="list"></div>
<script>
const JOBS=${JSON.stringify(jobs).replace(/</g, '\\u003c')};
const ACTIVE=['ranked','ready','opened','applied','interview','offer'];
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){
  const q=document.getElementById('q').value.toLowerCase(),s=document.getElementById('s').value,m=+document.getElementById('m').value;
  const out=JOBS.filter(j=>(s==='*'||(s?j.status===s:ACTIVE.includes(j.status)))&&(j.score??0)>=m&&
    (j.title+' '+j.company+' '+j.location).toLowerCase().includes(q));
  document.getElementById('list').innerHTML=out.map(j=>{const sc=j.score??'–',c=j.score>=75?'hi':j.score>=60?'mid':'lo';
    const href=/^https?:/i.test(j.url)?j.url:'#';
    return '<div class="card"><div class="score '+c+'">'+sc+'</div><div>'+
    '<a class="t" href="'+e(href)+'" target="_blank" rel="noopener">'+e(j.title)+'</a> @ <b>'+e(j.company)+'</b><span class="st">#'+j.id+' '+e(j.status)+'</span>'+
    '<div class="meta">'+e(j.location)+(j.salary?' · '+e(j.salary):'')+' · '+e(j.source)+(j.posted_at?' · posted '+e(String(j.posted_at).slice(0,10)):'')+'</div>'+
    (j.summary?'<div>'+e(j.summary)+'</div>':'')+
    (j.missing.length?'<div class="miss">Missing: '+e(j.missing.join(', '))+'</div>':'')+
    (j.flags.length?'<div class="flags">⚠ '+e(j.flags.join('; '))+'</div>':'')+'</div></div>'}).join('')||'<p>No jobs match.</p>';
}
['q','s','m'].forEach(id=>document.getElementById(id).addEventListener('input',render));render();
</script></body></html>`;

  const dir = path.join(ROOT, 'site');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  return file;
}
