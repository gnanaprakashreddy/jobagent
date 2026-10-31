import { state } from './store.js';
import { parseJSONLoose } from './match.js';

// All of these allow direct browser (CORS) calls with an OpenAI-compatible API.
export const PRESETS = {
  gemini: { label: 'Google Gemini — free key (recommended)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  groq: { label: 'Groq — free key, very fast', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { label: 'OpenRouter — free models', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys' },
  openai: { label: 'OpenAI (paid)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  github: { label: 'GitHub Models (token with models:read)', baseUrl: 'https://models.github.ai/inference', model: 'openai/gpt-4.1-mini', keyUrl: 'https://github.com/settings/personal-access-tokens/new' },
  ollama: { label: 'Ollama (runs on this computer)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyUrl: 'https://ollama.com/download' },
  custom: { label: 'Custom OpenAI-compatible', baseUrl: '', model: '', keyUrl: '' },
};

export function llmConfig() {
  const p = PRESETS[state.llm.preset] || PRESETS.custom;
  return {
    baseUrl: (state.llm.baseUrl || p.baseUrl).replace(/\/$/, ''),
    model: state.llm.model || p.model,
    apiKey: state.llm.apiKey,
  };
}

export const llmReady = () => !!(llmConfig().apiKey || state.llm.preset === 'ollama') && !!llmConfig().baseUrl;

let noJsonMode = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chatJSON(messages, { temperature = 0.3 } = {}) {
  const { baseUrl, model, apiKey } = llmConfig();
  if (!llmReady()) throw new Error('Set up an AI provider in Settings first.');
  for (let attempt = 0; attempt < 6; attempt++) {
    const body = { model, messages, temperature };
    if (!noJsonMode) body.response_format = { type: 'json_object' };
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Could not reach ${baseUrl} (${e.message}). Check the URL, or your network/ad-blocker.`);
    }
    if (res.status === 400 && !noJsonMode) {
      const t = await res.text();
      if (/response_format|json/i.test(t)) { noJsonMode = true; continue; }
      throw new Error(`AI error 400: ${t.slice(0, 300)}`);
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(Math.min(60000, (Number(res.headers.get('retry-after')) || 0) * 1000 || 3000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`AI provider rejected the key (${res.status}). Check Settings.`);
    if (!res.ok) throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return parseJSONLoose(data.choices?.[0]?.message?.content ?? '');
  }
  throw new Error('AI rate limit reached. Wait a minute and try again (free tiers allow ~10-30 requests/minute).');
}
