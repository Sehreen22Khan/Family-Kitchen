// Family Kitchen's AI helper: a small Cloudflare Worker between the app and Claude.
// It keeps the Anthropic API key secret, lets in only Kitchen Plus members, testers and
// (if you turn it on) trial users, caps how much each person can ask in a day, and
// streams short answers back for the phone to read out loud.
//
// Setup: see AI_SETUP.md in the repository.
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the voice of Family Kitchen, a meal-planning app for families who cook South Asian home food: one big prep session on Saturday, then quick weeknight dinners made from labelled boxes. People talk to you while they cook, often with messy hands, and the phone reads your reply out loud.

Answer like a calm, experienced home cook standing beside them:
- Use one to three short sentences of plain spoken language. Everything you write is spoken, so don't use lists, headings, markdown, emoji or symbols, and say quantities the way people say them out loud.
- Ground your answers in the app context: the dish, the step on screen, the boxes (call them by their labels, like "Monday marinade"), the family's preferences, the foods they avoid and the appliances they don't have. Don't contradict the recipe. When the recipe doesn't cover something, give your best practical advice and say it's a suggestion.
- The plan is halal: never suggest pork, alcohol or other non-halal ingredients.
- Food safety comes first. Give standard, safe guidance on raw meat, storage, reheating and doneness, and say plainly when something isn't safe.
- Help with cooking, food, the meal plan, shopping and the kitchen. If someone asks about anything else, say in one sentence that you can only help in the kitchen.
- Use the tools to do things on the phone: timers, moving between steps, the shopping list and starting cook mode. Say in a few words what you did. After you move to another step, don't read that step out; the app reads it.
- If the question isn't clear, ask them to say it again.`;

// Actions the phone carries out. Tool order stays fixed so the prompt cache keeps hitting.
const TOOLS = [
  {
    name: 'set_timer',
    description: 'Start a kitchen timer on the phone. Use it when the cook asks for a timer, or asks you to remind them after some time.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'Length in minutes. Fractions are fine: 0.5 is 30 seconds.' },
        label: { type: 'string', description: 'A few words saying what the timer is for, like "chicken in the air fryer".' }
      },
      required: ['minutes']
    }
  },
  {
    name: 'stop_timers',
    description: 'Stop the running or ringing timers.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'next_step',
    description: 'In cook mode, tick off the current step and move to the next one. Use it when the cook says they have finished the step or wants the next one.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'previous_step',
    description: 'In cook mode, go back one step.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'go_to_step',
    description: 'In cook mode, jump to a step by its number.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { step: { type: 'integer', description: 'The step number, starting at 1.' } },
      required: ['step']
    }
  },
  {
    name: 'add_to_shopping_list',
    description: "Add things to the family's shopping list.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'string' }, description: 'Each item the way the cook would write it, like "2 kg onions".' }
      },
      required: ['items']
    }
  },
  {
    name: 'start_cooking',
    description: 'Open hands-free cook mode for the day on screen, so the app reads the steps out loud and listens.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: {} }
  }
];

const LANGS = {
  en: 'Reply in English.',
  hi: 'Reply in simple spoken Hindi, written in Devanagari script. Dish names and box labels can stay as they are.',
  ur: 'Reply in simple spoken Urdu, written in Urdu script. Dish names and box labels can stay as they are.'
};

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (!cors) return new Response('Not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(request.url).pathname;
    try {
      if (request.method === 'POST' && path === '/unlock') return await unlock(request, env, cors);
      if (request.method === 'POST' && path === '/ask') return await ask(request, env, ctx, cors);
      if (request.method === 'GET' && path === '/') return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY && !!env.TOKEN_SECRET }, 200, cors);
    } catch (err) {
      return json({ error: 'bad_request' }, 400, cors);
    }
    return json({ error: 'not_found' }, 404, cors);
  }
};

// ----- Who may ask -----

// Swap a Plus licence key, a tester key or a trial for a pass the phone keeps.
// Tester keys arrive here once and are never stored; the pass names only their fingerprint.
async function unlock(request, env, cors) {
  if (!env.TOKEN_SECRET) return json({ error: 'not_configured' }, 503, cors);
  const body = await readJSON(request, 2000);
  const key = typeof body.key === 'string' ? body.key.trim().slice(0, 100) : '';
  if (key) {
    const fp = await sha256hex('family-kitchen/tester/' + key.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (list(env.TESTER_KEYS).includes(fp)) {
      if (testingOver(env)) return json({ error: 'testing_over' }, 403, cors);
      return json(await issue(env, { k: 'tester', s: 't' + fp.slice(0, 16) }, 30), 200, cors);
    }
    const instance = typeof body.instance === 'string' ? body.instance.slice(0, 100) : '';
    if (await plusLicenceValid(key, instance, env)) {
      return json(await issue(env, { k: 'plus', s: 'p' + (await sha256hex('licence/' + key)).slice(0, 16) }, 7), 200, cors);
    }
    return json({ error: 'invalid_key' }, 403, cors);
  }
  if (body.trial === true && env.TRIAL_AI === 'on') {
    if (!trialAllowed(request)) return json({ error: 'daily_limit' }, 429, cors);
    return json(await issue(env, { k: 'trial', s: 'r' + crypto.randomUUID().replace(/-/g, '').slice(0, 16) }, 7), 200, cors);
  }
  return json({ error: 'no_key' }, 400, cors);
}

async function plusLicenceValid(key, instance, env) {
  const form = new URLSearchParams({ license_key: key });
  if (instance) form.set('instance_id', instance);
  try {
    const r = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const j = await r.json();
    const status = (j.license_key && j.license_key.status) || '';
    return !!j.valid && (!env.STORE_ID || String(j.meta && j.meta.store_id) === String(env.STORE_ID)) && !/expired|disabled/.test(status);
  } catch (err) {
    return false;
  }
}

function testingOver(env) {
  return !!env.TESTER_UNTIL && Date.now() > Date.parse(env.TESTER_UNTIL + 'T23:59:59Z');
}

// Passes are signed with TOKEN_SECRET, so they can't be made up or edited
async function issue(env, claims, days) {
  let exp = Date.now() + days * 864e5;
  if (claims.k === 'tester' && env.TESTER_UNTIL) exp = Math.min(exp, Date.parse(env.TESTER_UNTIL + 'T23:59:59Z'));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ ...claims, exp })));
  return { token: payload + '.' + b64url(await hmac(env, payload)), exp, kind: claims.k };
}

async function verify(env, token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !env.TOKEN_SECRET) return null;
  const key = await hmacKey(env);
  const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), new TextEncoder().encode(payload));
  if (!ok) return null;
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch (err) { return null; }
  if (!claims || !(claims.exp > Date.now())) return null;
  // Removing a tester fingerprint, or passing TESTER_UNTIL, ends that tester's passes straight away
  if (claims.k === 'tester' && (testingOver(env) || !list(env.TESTER_KEYS).some((f) => f.startsWith(claims.s.slice(1))))) return null;
  return claims;
}

// ----- Asking -----

async function ask(request, env, ctx, cors) {
  const claims = await verify(env, (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
  if (!claims) return json({ error: 'unauthorized' }, 401, cors);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503, cors);
  const body = await readJSON(request, 24000);
  const q = text(body.q, 600);
  if (!q) return json({ error: 'empty' }, 400, cors);
  const limit = claims.k === 'trial' ? num(env.TRIAL_DAILY_LIMIT, 10) : num(env.DAILY_LIMIT, 25);
  if (!(await countUse(env, claims.s, limit))) return json({ error: 'daily_limit', limit }, 429, cors);

  // Earlier turns go back as plain text, so tool calls never need answering in the history
  const messages = [];
  for (const h of (Array.isArray(body.history) ? body.history : []).slice(-8)) {
    const role = h && h.role === 'assistant' ? 'assistant' : 'user';
    const t = text(h && h.text, 800);
    if (!t || (!messages.length && role !== 'user')) continue;
    messages.push({ role, content: t });
  }
  const lang = LANGS[body.lang] ? body.lang : 'en';
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: '<app_context>\n' + text(body.context, 8000) + '\n</app_context>' },
      { type: 'text', text: LANGS[lang] },
      { type: 'text', text: q }
    ]
  });

  const model = env.MODEL || 'claude-opus-5-5';
  const params = {
    model,
    max_tokens: 4000, // answers are a few spoken sentences; this also caps the cost of one question
    output_config: { effort: env.EFFORT || 'low' }, // quick, conversational replies
    cache_control: { type: 'ephemeral' }, // the instructions and tools stay the same, so they're cached
    system: SYSTEM,
    tools: TOOLS,
    messages
  };
  // On a refusal, Anthropic retries on its recommended fallback model. Haiku has no server-side fallback.
  if (!/haiku/i.test(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1 });
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (o) => writer.write(enc.encode(JSON.stringify(o) + '\n'));

  // The phone gets one JSON line per event: text as it's written, then any actions, then done
  const work = (async () => {
    try {
      const stream = client.beta.messages.stream(params);
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'fallback') {
          await send({ t: 'restart' }); // the first model stopped mid-answer; the fallback answers afresh
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          await send({ t: 'text', d: event.delta.text });
        }
      }
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') {
        await send({ t: 'refusal' });
      } else if (msg.stop_reason !== 'max_tokens') {
        // A cut-off answer may carry a half-written action, so actions only run on a finished answer
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          const input = checkTool(block.name, block.input);
          if (input) await send({ t: 'tool', name: block.name, input });
        }
      }
      await send({ t: 'done', stop: msg.stop_reason });
    } catch (err) {
      await send({ t: 'error', code: err instanceof Anthropic.APIError ? err.status || 500 : 0 });
    } finally {
      try { await writer.close(); } catch (err) { /* already closed */ }
    }
  })();
  ctx.waitUntil(work);
  return new Response(readable, { headers: { ...cors, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Actions are checked against their schema before the phone ever sees them
function checkTool(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'next_step': case 'previous_step': case 'stop_timers': case 'start_cooking':
      return {};
    case 'set_timer': {
      const minutes = Number(i.minutes);
      if (!(minutes > 0 && minutes <= 600)) return null;
      return { minutes, label: typeof i.label === 'string' ? i.label.slice(0, 60) : '' };
    }
    case 'go_to_step': {
      const step = Number(i.step);
      return Number.isInteger(step) && step >= 1 && step <= 200 ? { step } : null;
    }
    case 'add_to_shopping_list': {
      const items = Array.isArray(i.items) ? i.items.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 12) : [];
      return items.length ? { items } : null;
    }
    default:
      return null;
  }
}

// ----- Daily limits -----
// With a KV namespace bound as USAGE the count is shared by every Cloudflare location;
// without it each worker instance counts on its own, which is looser.
const memoryCounts = new Map();
async function countUse(env, who, limit) {
  const k = who + ':' + new Date().toISOString().slice(0, 10);
  if (env.USAGE) {
    const n = Number(await env.USAGE.get(k)) || 0;
    if (n >= limit) return false;
    await env.USAGE.put(k, String(n + 1), { expirationTtl: 2 * 86400 });
    return true;
  }
  const n = memoryCounts.get(k) || 0;
  if (n >= limit) return false;
  memoryCounts.set(k, n + 1);
  if (memoryCounts.size > 5000) memoryCounts.clear();
  return true;
}
const trialCounts = new Map();
function trialAllowed(request) {
  const k = (request.headers.get('CF-Connecting-IP') || 'unknown') + ':' + new Date().toISOString().slice(0, 10);
  const n = trialCounts.get(k) || 0;
  if (n >= 5) return false;
  trialCounts.set(k, n + 1);
  if (trialCounts.size > 5000) trialCounts.clear();
  return true;
}

// ----- Small helpers -----
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = list(env.ALLOWED_ORIGINS);
  if (origin && allowed.length && !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
function json(o, status, cors) {
  return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
async function readJSON(request, maxBytes) {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new Error('too large');
  const o = JSON.parse(raw || '{}');
  return o && typeof o === 'object' ? o : {};
}
function text(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function num(v, d) { const n = Number(v); return n > 0 ? n : d; }
function list(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hmac(env, payload) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(payload)));
}
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
