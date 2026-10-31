import { execSync } from 'node:child_process';

// Any OpenAI-compatible Chat Completions endpoint works:
//   GitHub Models (default): LLM_BASE_URL=https://models.github.ai/inference  (key = GitHub token)
//   OpenAI:                  LLM_BASE_URL=https://api.openai.com/v1
//   Ollama (local, free):    LLM_BASE_URL=http://localhost:11434/v1  LLM_API_KEY=ollama
let cachedKey;
function apiKey() {
  if (cachedKey) return cachedKey;
  cachedKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN;
  if (!cachedKey) {
    try {
      cachedKey = execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      /* fall through */
    }
  }
  if (!cachedKey) throw new Error('No LLM API key. Set LLM_API_KEY in .env (or log in with "gh auth login" to use GitHub Models).');
  return cachedKey;
}

export function llmInfo() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || 'https://models.github.ai/inference').replace(/\/$/, ''),
    model: process.env.LLM_MODEL || 'openai/gpt-4.1-mini',
  };
}

export async function chat(messages, { json = false, temperature = 0.3 } = {}) {
  const { baseUrl, model } = llmInfo();
  const body = { model, messages, temperature };
  if (json) body.response_format = { type: 'json_object' };

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}`, 'api-key': apiKey() },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 60000)));
      continue;
    }
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`LLM endpoint ${baseUrl} returned a non-API response ("${text.slice(0, 80).trim()}"). ` +
        'It may be blocked by a proxy/firewall or unavailable for your account; set LLM_BASE_URL/LLM_API_KEY/LLM_MODEL in .env to another provider.');
    }
    return data.choices?.[0]?.message?.content ?? '';
  }
  throw new Error('LLM rate limit: retries exhausted. Try again later or lower maxJobsToRank.');
}

export async function chatJSON(messages, opts) {
  const raw = await chat(messages, { ...opts, json: true });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`LLM did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}
