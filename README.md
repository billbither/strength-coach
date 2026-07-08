# Strength Coach

A personal training coach that lives in Telegram — strength work, running, cycling, classes (barre, yoga, spin...), whatever you actually do. You text it like a human coach: describe a workout and it logs it, ask what's next and it answers from your actual history, step on the scale and tell it the number. Behind the scenes it's a [Mastra](https://mastra.ai) agent running on Fly.io, powered by two DeepSeek models, with all of your data stored as plain files in a GitHub repo you own. One deployment can coach multiple people (see Households below) — each with their own bot conversation, data repo, plan, and briefs.

Two brains:

- **`deepseek-chat`** handles the day-to-day conversation, logging, a 7 AM daily brief, and a 1 PM movement-snack nudge.
- **`deepseek-reasoner`** runs every night at 2 AM, reads your entire history, and rewrites `coach-plan.md` — the forward plan (next sessions with exact weights/reps, volume strategy, deload countdown) that the chat coach quotes during the day.

Running cost is about $5/month: ~$3.20 for the Fly machine, $1-2 in DeepSeek tokens.

## How your data is stored

The agent code (this repo) and your training data live in **two separate GitHub repos**. You must create the second one — a private **data repo** that holds:

| File | Purpose |
|---|---|
| `coach-rules.md` | Your coaching rulebook: profile, injuries and safety rules, logging conventions, volume targets |
| `equipment.md` | What you own and have access to — the coach never programs gear you don't have; tell it about new purchases and it updates this |
| `activities.md` | What you do and enjoy (cardio favorites, classes, sports), each marked programmed vs just-logged |
| `strength-program.md` | Your program: the rotating sessions across all modalities and the progression scheme |
| `workout-log.csv` | Every workout, one row per exercise |
| `snacks.csv` | Movement snacks (pull-ups between calls, etc.) |
| `body.csv` | Weigh-ins and body composition |
| `records.md` | Your PR board |
| `coach-plan.md` | The forward plan, regenerated nightly |

Every log entry is a git commit, so your training history is versioned, diffable, and portable. You don't have to write any of these files yourself — the `/init` command (step 7) interviews you in Telegram and generates all of them.

## Setup

### 1. Create the Telegram bot (2 minutes)

1. In Telegram, message **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`.
2. Save the token it gives you (`123456:AAE...`) — this is `TELEGRAM_BOT_TOKEN`.
3. Open a chat with your new bot and send it any message (this matters — bots can't see you until you message first).
4. Get your numeric chat id: visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and read `result[0].message.chat.id`. That's `TELEGRAM_CHAT_ID`. The agent only ever talks to this one chat id — messages from anyone else are dropped.

### 2. Create the data repo

Create a new **private, empty** GitHub repo (e.g. `yourname/strength-training`). Don't add any files — `/init` will populate it. `owner/name` is your `GITHUB_REPO`.

### 3. Create a scoped GitHub token

At [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):

- Repository access: **Only select repositories** → your data repo
- Permissions: **Contents → Read and write**
- Everything else: none

This token is `GITHUB_TOKEN`. Scoping it to one repo means the deployed agent can touch your training data and nothing else you own.

### 4. Get a DeepSeek API key

Sign up at [platform.deepseek.com](https://platform.deepseek.com), add a small balance ($2 lasts months), create an API key. That's `DEEPSEEK_API_KEY`.

### 5. Deploy to Fly.io

Install [flyctl](https://fly.io/docs/flyctl/install/) and sign up (`flyctl auth login`; add a card — trial accounts stop idle machines, which silently kills the scheduled briefs).

```bash
git clone https://github.com/billbither/strength-coach.git && cd strength-coach
cp .env.example .env        # fill in every value; generate WEBHOOK_SECRET with: openssl rand -hex 24

# pick your own globally-unique app name in fly.toml ("app = ..."), then:
flyctl apps create <your-app-name>
set -a; source .env; set +a
flyctl secrets set --stage \
  TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" \
  DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  GITHUB_TOKEN="$GITHUB_TOKEN" \
  GITHUB_REPO="$GITHUB_REPO" \
  WEBHOOK_SECRET="$WEBHOOK_SECRET"
flyctl deploy --ha=false
```

Notes: the machine needs 512MB (already set in `fly.toml`; 256MB gets OOM-killed). `auto_stop_machines` is off on purpose — the cron schedules only fire while the process is alive. Cron times and the `America/New_York` timezone are set in `src/server.ts`; edit them there if you want different hours.

### 6. Point Telegram at your app

```bash
APP_URL=https://<your-app-name>.fly.dev node scripts/set-webhook.mjs
```

(Reads `TELEGRAM_BOT_TOKEN` and `WEBHOOK_SECRET` from your shell — `source .env` first if you opened a new terminal.) You should see `{"ok":true,...,"description":"Webhook was set"}`.

### 7. Initialize in Telegram

Message your bot: `/init`

The bot switches into setup mode and interviews you — name, age, height/weight, what you do and enjoy (lifting, running, cycling, classes), which of those you want programmed vs just logged, goals, equipment, injuries, schedule — one question at a time. When it has the picture, it confirms a summary with you, then generates and commits your entire data repo: coaching rulebook, a program matched to your answers across all your activities, empty log files, and a PR board. Send `/done` when it tells you setup is complete.

If the machine restarts mid-interview (rare), just send `/init` again — it starts fresh.

## Daily use

Just talk to it:

- *"Did workout B today. Goblet squats 3x12 at 55, swings 4x25..."* → logged, committed, PRs checked, safety-audited
- *"185.2 this morning, 14.1% body fat"* → logged with computed BMI
- *"Knocked out 20 pushups between meetings"* → tallied toward your weekly volume
- *"What should I do tomorrow?"* → answered from the nightly plan and your real history

Commands:

| Command | What it does |
|---|---|
| `/brief` | Send the morning brief now (today's session, exact targets, volume status) |
| `/week` | Week-to-date volume vs targets |
| `/plan` | Re-run the deep planner now and get a digest |
| `/init` | Enter setup mode (re-interview / rebuild data repo files) |
| `/done` | Exit setup mode |

Scheduled (all times America/New_York, DST-aware): morning brief 7:00 AM, snack nudge 1:00 PM, nightly re-plan 2:00 AM.

## Households: multiple people, one deployment

One bot and one Fly machine can coach several people. Each person needs their own **data repo** (create it empty, like step 2) and their own Telegram **chat id** — but they share the bot, the machine, and the DeepSeek key.

1. Have the new person open the bot and send it any message. Their chat id appears in the app logs: `flyctl logs` → "message from unconfigured chat id 123456789".
2. Make sure your `GITHUB_TOKEN` has access to their data repo too (edit the token's repository list on GitHub), or that their repo is under the same account.
3. Set the `USERS` secret (replaces the single-user vars):

```bash
flyctl secrets set USERS='[
  {"chatId":"111111111","repo":"you/your-training","name":"You"},
  {"chatId":"222222222","repo":"you/partner-training","name":"Partner"}
]'
```

4. They send `/init` and get interviewed like any new user. Everyone gets their own briefs, nightly plan, history, and PR board; nobody sees anyone else's data in chat.

## Operations

```bash
flyctl logs -a <your-app-name>          # live logs
flyctl deploy --ha=false                # redeploy after code changes
flyctl secrets set KEY=value            # rotate a secret (triggers restart)
```

The webhook rejects any request without your `WEBHOOK_SECRET` (Telegram sends it as a header on every delivery), and the agent ignores messages from any chat but yours. During a deploy there's a ~15 second restart window; Telegram retries deliveries automatically, so messages aren't lost.

## Architecture

```
Telegram ──webhook──▶ Hono server on Fly.io
                        ├─ coach agent (deepseek-chat) ──┐
                        ├─ onboarder agent (/init)       ├──▶ GitHub data repo
                        ├─ cron 7:00 / 13:00  briefs     │    (every log = a commit)
                        └─ cron 2:00  planner (deepseek-reasoner) ──▶ coach-plan.md
```

Replies are plain text by design — Telegram doesn't render markdown, and a stripper in `src/telegram.ts` catches what the model leaks despite instructions (tested: instructions alone aren't enough).
