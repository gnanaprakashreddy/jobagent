# Job Agent 🚀

An LLM agent that **finds jobs, ranks them against your resume, and writes tailored application kits**, so you can apply to 10+ high-fit jobs a day in minutes.

```
search (5 job boards) ─► keyword pre-filter ─► LLM fit scoring ─► tailored kit ─► you apply ─► tracker + follow-ups
```

For each strong match the agent writes `applications/<id>-<company>-<role>/application.md` with:
- a tailored **cover letter** (also saved as `cover-letter.txt` for pasting)
- a **targeted resume summary** and **bullet rewrites** that mirror the job's keywords
- **ATS keywords** plus the keywords your resume is missing
- a **recruiter/hiring-manager LinkedIn message**, which is often the fastest route to an interview
- answers to likely **screening questions** and **interview prep topics**

The agent never invents experience. You review everything and click "Submit" yourself. That keeps quality high and avoids breaking the job boards' terms of service.

## Setup (2 minutes)

Requires Node.js 22.13+.

```powershell
cd C:\Users\z004h8pf\job-agent
npm install
node src/cli.js init          # creates profile.json and .env
```

1. Put your resume (PDF, DOCX, TXT or MD) in this folder and set `resumePath` in `profile.json`.
2. Fill in `targetRoles`, `skills`, `locations`, `excludeKeywords` and your contact details in `profile.json`.
3. Configure an LLM in `.env`. Any OpenAI-compatible API works:
   | Provider | LLM_BASE_URL | LLM_MODEL |
   |---|---|---|
   | OpenAI | `https://api.openai.com/v1` | `gpt-4.1-mini` |
   | GitHub Models | `https://models.github.ai/inference` | `openai/gpt-4.1-mini` |
   | Ollama (free, local) | `http://localhost:11434/v1` | `llama3.1` |
   | Groq / OpenRouter / Together, etc. | their `/v1` URL | any model |
4. Optional: add free [Adzuna](https://developer.adzuna.com) keys to `.env` for on-site jobs in India, the US, the UK and the EU (`adzunaCountry`: `in`, `us`, `gb`, `de`, ...).

## Daily workflow

```powershell
node src/cli.js run                 # search + rank + prepare kits for the top matches
node src/cli.js list                # best matches first
node src/cli.js show 42             # fit analysis: matching/missing skills, red flags
node src/cli.js prepare 42 57       # build kits for specific jobs
node src/cli.js open 42             # opens the apply page and your kit side by side
node src/cli.js mark 42 applied     # track it (interview / offer / rejected / ...)
node src/cli.js followups --days 7  # drafts follow-up emails/DMs for silent applications
node src/cli.js stats
```

Tip: schedule `node src/cli.js run` daily with Windows Task Scheduler so fresh jobs are ranked before you wake up. Applying early matters.

## Tuning

| Setting (`profile.json`) | Effect |
|---|---|
| `maxJobsToRank` | LLM calls per run (cost/speed) |
| `minScoreToPrepare` | Only build kits for jobs scoring at least this |
| `autoPrepareTop` | Number of kits `run` builds |
| `excludeKeywords` | Drops jobs whose **title/tags** contain these |
| `remoteOnly` / `strictLocation` | Hard location filters |
| `maxAgeDays` | Ignore stale postings |
| `sources` | `remotive`, `remoteok`, `arbeitnow`, `themuse`, `adzuna` |

To add a job source, add a function to `src/sources.js` that returns normalized jobs.

Data lives in `data/jobs.db` (SQLite) and your kits are in `applications/`.

## Free hosting: GitHub Actions + GitHub Pages

The workflow in `.github/workflows/job-agent.yml` runs the agent **daily at 07:00 IST** at no cost:
- **AI is free** through GitHub Models, using the workflow's built-in `GITHUB_TOKEN`. No API key is needed.
- A **dashboard** of ranked jobs is published to GitHub Pages: `https://<user>.github.io/jobagent/`. It shows job titles, scores and fit notes, but never your resume or contact details.
- **Application kits** are uploaded as a workflow artifact (kept for 3 days).
- The tracker database persists between runs in the Actions cache.

### One-time setup
1. **Settings → Secrets and variables → Actions → New repository secret**:
   - `PROFILE_JSON`: the full contents of your `profile.json` (`resumePath` is ignored)
   - `RESUME_B64`: your resume as base64. In PowerShell:
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("resume.pdf")) | Set-Clipboard`
   - Optional: `LLM_API_KEY` (plus variables `LLM_BASE_URL`/`LLM_MODEL`) to use another provider, and `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Actions → Job Agent → Run workflow**.

### Using it from anywhere (including your phone)
**Actions → Job Agent → Run workflow**, then pick a command:
- `mark` with args `42 applied`
- `prepare` with args `42 57`, then download the `application-kits` artifact from the run
- `followups` with args `--days 7`, then read the drafts in the run log

> ⚠️ This repo is public. Secrets stay private, but anyone signed in to GitHub can download workflow artifacts (your kits) and read run logs. Leave phone/email out of `PROFILE_JSON` if that concerns you, or make the repo private. Private repos get 2,000 free Actions minutes a month, but Pages on a private repo needs a paid plan.
>
> GitHub pauses scheduled workflows after 60 days without repo activity. Re-enable it from the Actions tab.
