# Setting up the AI helper

The voice in Family Kitchen already reads steps out loud and understands simple commands ("next", "repeat", "timer 10 minutes") on the phone, for free.
The **AI helper** adds a real conversation. People can ask anything while they cook, in English, Hindi or Urdu:

- "Kitchen, can I use chicken thighs instead?"
- "Kitchen, I'm out of yogurt. What can I use?"
- "Kitchen, the onions are catching. What do I do?"
- "Kitchen, set a timer for 12 minutes and go to the next step." It does both.

It answers from tonight's recipe, the step on screen, the labelled boxes, the family's food answers and the appliances they don't have.
It can also set and stop timers, move between steps, add to the shopping list and start cook mode.
It's part of **Kitchen Plus**, and testers and people on the free trial can use it too.

## How it works, and why there's a small server

The answers come from **Claude**, Anthropic's AI. Every question costs a little money and needs your secret API key.
A key placed in the app could be copied by anyone, so the app talks to a tiny server instead. The code is in the `ai/` folder and runs free on **Cloudflare Workers**. The server:

- keeps the API key secret
- only answers Kitchen Plus members, tester-key holders and (if you allow it) people on the free trial
- limits how many questions each person can ask a day
- streams short answers back, so the phone starts speaking straight away

Until you set it up, the app works exactly as before, just without the AI helper.

## What it costs

Each question costs about **1.3 cents** with the default model, Claude Opus 5.5, which gives the best answers.
A busy Saturday question with the full prep list costs about **3 cents**.
Claude Haiku 5.5 costs about **0.03 cents** a question, around 40 times less. It's faster too, and its answers are simpler.

For example, a Plus member who asks 2 questions a day costs about **$0.80 a month on Opus**, or **$0.02 on Haiku**.
Yearly Plus is about $1.67 a month, so with heavy use Opus can eat a large share of it. Haiku costs almost nothing.
To switch, change `MODEL` in `ai/wrangler.toml` to `claude-haiku-5-5`.

Cloudflare's free plan covers 100,000 requests a day, so the server itself costs nothing.

## Setup (about 20 minutes)

### 1. Get an Anthropic API key and set a spending limit

1. Sign up at **console.anthropic.com** and add a payment method.
2. Go to **API keys** → **Create key**. Copy it somewhere safe for step 3.
3. Go to the spending limits page (under **Settings** or **Billing**). Set a **monthly limit**, for example $20. This is your safety net: whatever happens, you'll never spend more than this.

### 2. Put the server on Cloudflare (no software to install)

1. Sign up free at **dash.cloudflare.com**.
2. Open **Workers & Pages** → **Create** → **Import a repository**, connect GitHub and pick the **Family-Kitchen** repository.
3. Set the **root directory** (sometimes called path) to `ai`. Keep the build settings Cloudflare suggests; the deploy command is `npx wrangler deploy`.
4. Click **Deploy**. When it finishes, Cloudflare shows the server's address, something like `https://family-kitchen-ai.yourname.workers.dev`. Copy it.

Cloudflare's screens change from time to time, so the button names may differ slightly.
If you'd rather use the command line: install Node.js, then run `npm install` and `npx wrangler deploy` inside the `ai` folder.

### 3. Add the two secrets

In Cloudflare, open the worker → **Settings** → **Variables and Secrets**, and add two **secrets**:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from step 1 |
| `TOKEN_SECRET` | any long random password, e.g. 40 letters and numbers. The server uses it to sign passes, so keep it private |

Command line instead: `npx wrangler secret put ANTHROPIC_API_KEY` and `npx wrangler secret put TOKEN_SECRET`.

### 4. Tell the app where the server is

In `index.html`, find this line near the top of the script and paste your server's address in:

```js
var AI_URL = 'https://family-kitchen-ai.yourname.workers.dev';
```

Commit and push. That's it.

### 5. Try it

Open the app, unlock Plus (your tester key works), tap 🎙️ at the top and ask "Can I use chicken thighs instead?"
You can also check the server on its own: open its address in a browser, and it should say `{"ok":true,"ai":true}`.

## Settings in `ai/wrangler.toml`

| Setting | What it does |
|---|---|
| `ALLOWED_ORIGINS` | Websites allowed to use the server: your app's address. Add `http://localhost:8765` to test on a computer. |
| `MODEL` | `claude-opus-5-5` (best answers) or `claude-haiku-5-5` (much cheaper and faster). |
| `EFFORT` | How hard Claude thinks before answering. `low` suits quick spoken answers. |
| `DAILY_LIMIT` | Questions per person per day (default 25). |
| `TRIAL_AI`, `TRIAL_DAILY_LIMIT` | Whether people on the 7-day free trial can use the AI helper, and how much (default: yes, 10 a day). |
| `STORE_ID` | Your Lemon Squeezy store ID, so only your customers' licence keys work. |
| `TESTER_KEYS`, `TESTER_UNTIL` | The same tester fingerprints and end date as in `index.html`. Keep the two files in step: removing a fingerprint in both ends that tester's AI access too. |

After changing a setting, commit and push. Cloudflare redeploys by itself if you set it up from GitHub, or you can run `npx wrangler deploy`.

**Optional, sharper daily limits.** Without extra setup, each Cloudflare location counts questions on its own, so a determined person could ask a little more than the limit.
To count everything in one place, create a KV store (`npx wrangler kv namespace create USAGE`) and paste its id into the commented-out lines at the bottom of `wrangler.toml`.
On the free plan, KV allows about 1,000 questions a day across everyone.

## Privacy

When someone asks the AI helper a question, the server sends Anthropic:

- the question and the last few questions and answers
- the recipe on screen, with its steps and boxes
- the family's food answers (what they eat, spice, foods to avoid, missing appliances)
- running timers and the shopping list

The server doesn't log or store any of it. Anthropic handles it under its commercial terms.
Add a sentence about this to your privacy policy. The Voice settings in the app tell people too.

## Testers

Your testers' AI access uses the same tester key as Plus.
Anyone who entered the key before the AI helper existed is asked for it **once more**, the first time they ask a question. The phone never keeps the key, so it needs it once to get an AI pass.

## If something doesn't work

| What you see | What to check |
|---|---|
| "The AI helper is part of Kitchen Plus" | The person isn't on Plus, a tester key or the trial, or `TRIAL_AI` is off. |
| "I couldn't reach the AI helper" | `AI_URL` in `index.html` matches the server's address, and the phone is online. |
| Server address shows `"ai":false` | One of the two secrets is missing. |
| "That's all the AI questions for today" | The person reached `DAILY_LIMIT`. |
| Nothing happens in cook mode | In cook mode, questions must start with "Kitchen…". |
