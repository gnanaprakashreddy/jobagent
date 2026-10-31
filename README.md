# Job Agent 🚀

An AI agent that **finds jobs matching your resume, skills and preferences, ranks them, and writes tailored application kits**, so you can apply to 10+ high-fit jobs a day.

**🌐 Open the app: https://gnanaprakashreddy.github.io/jobagent/** (works on phone and desktop, free)

```
1,000+ fresh jobs (refreshed every 6 h) ─► match score vs your profile ─► AI fit ranking ─► tailored kit ─► you apply ─► tracker + follow-ups
```

## Get started (3 minutes, free)

1. **Profile:** upload your resume (PDF/DOCX), click **✨ Auto-fill profile from resume**, adjust your target roles, skills, locations and salary, then **Save**.
2. **Settings:** pick an AI provider and paste a free key:
   - **Google Gemini** (recommended): https://aistudio.google.com/apikey
   - **Groq** (very fast): https://console.groq.com/keys
   - OpenRouter free models, OpenAI, GitHub Models, or local Ollama also work.
3. **Jobs:** browse matches sorted by score. Click **✨ AI-rank** to get a fit score, matching and missing skills and red flags. Open **Details → Generate application kit** to get:
   - a tailored **cover letter** and **recruiter/LinkedIn message**
   - a **resume summary** and **bullet rewrites** using the job's keywords
   - **ATS keywords**, keywords missing from your resume, screening answers, and interview prep
   
   Then **Apply ↗**, mark **📨 Applied**, and follow your pipeline in **Tracker**. It drafts follow-ups after 7 days.

### Use it on all your devices (optional)
**Settings → Sync** stores your profile, resume text and tracker in a **secret Gist in your own GitHub account**. Create a [classic token with only the `gist` scope](https://github.com/settings/tokens/new?scopes=gist&description=Job%20Agent%20sync), paste it on each device, and you're synced. AI keys are never synced.

## Privacy
- The site is static (GitHub Pages). The public `jobs.json` contains only public job postings.
- Your resume is parsed **in your browser**. Your profile, resume and tracker are stored in your browser's localStorage, plus your own secret Gist if you enable sync.
- AI calls go **directly from your browser** to the provider you choose. Your key is stored only on your device.
- The agent never invents experience. You review everything and submit applications yourself.

## How it works
- `.github/workflows/deploy.yml` runs every 6 hours, and on every push. It runs `node src/cli.js feed` to fetch jobs from Remotive, RemoteOK, Arbeitnow, The Muse, Jobicy, Himalayas (and optionally Adzuna), dedupes them, and deploys `web/` plus `jobs.json` to GitHub Pages.
- Customize the feed under **Settings → Secrets and variables → Actions → Variables**:
  | Variable | Default |
  |---|---|
  | `FEED_QUERIES` | `software engineer,developer,data,devops,product manager,designer` |
  | `FEED_LOCATIONS` | (Adzuna only) e.g. `Bangalore,Hyderabad,Remote` |
  | `ADZUNA_COUNTRY` | `in` |
  
  Add the secrets `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` (free at https://developer.adzuna.com) for on-site jobs in India, the US, the UK and the EU.
- GitHub pauses scheduled workflows after 60 days without repo activity. Re-enable it from the Actions tab.

Code: `web/` (the app: `app.js`, `match.js` scoring and prompts, `llm.js`, `store.js` storage and sync, `resume.js`) and `src/` (job sources, feed builder, CLI).

## Local CLI (optional)

Requires Node.js 22.13+.

```powershell
npm install
node src/cli.js init                # creates profile.json and .env (set resumePath, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)
node src/cli.js run                 # search + rank + prepare kits for the top matches
node src/cli.js list                # best matches first
node src/cli.js show 42             # fit analysis
node src/cli.js prepare 42 57       # build kits -> applications/
node src/cli.js open 42             # open the apply page and your kit
node src/cli.js mark 42 applied
node src/cli.js followups --days 7
node src/cli.js stats
node src/cli.js feed                # build the static site into site/
```
