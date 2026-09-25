# Strength Coach

A personal training coach that lives in Telegram — strength work, running, cycling, classes (barre, yoga, spin...), whatever you actually do. You text it like a human coach: describe a workout and it logs it, ask what's next and it answers from your actual history, step on the scale and tell it the number. Behind the scenes it's a [Mastra](https://mastra.ai) agent running on Fly.io, powered by two DeepSeek models, with each person's data in a private SQLite database on a persistent Fly volume. One deployment can coach multiple people (see Households below) — each with their own bot conversation, data, plan, and briefs.

Two brains:

- **`deepseek-chat`** handles the day-to-day conversation, logging, a 7 AM daily brief, and a 1 PM movement-snack nudge.
- **`deepseek-reasoner`** runs every night at 2 AM, reads your entire history, and rewrites `coach-plan.md` — the forward plan (next sessions with exact weights/reps, volume strategy, deload countdown) that the chat coach quotes during the day.

Running cost is about $5–6/month at current usage: the Fly machine and volume, plus DeepSeek tokens.

## How your data is stored

The app stores these familiar documents, CSV logs, and body photos as records in **SQLite**. The database lives at `/data/coach.sqlite` on a persistent Fly volume. Each person has a separate storage key.

| File | Purpose |
|---|---|
| `coach-rules.md` | Your coaching rulebook: profile, injuries and safety rules, logging conventions, volume targets |
| `equipment.md` | What you own and have access to — the coach never programs gear you don't have; tell it about new purchases and it updates this |
| `activities.md` | What you do and enjoy (cardio favorites, classes, sports), each marked programmed vs just-logged |
| `strength-program.md` | Your program: the rotating sessions across all modalities and the progression scheme |
| `workout-log.csv` | Every workout, one row per exercise |
| `snacks.csv` | Movement snacks (pull-ups between calls, etc.) |
| `body.csv` | Weigh-ins and body composition — a wide schema with muscle mass, skeletal muscle, bone/protein/water mass, visceral fat, BMR, body age, and segmental muscle+fat per arm/leg/trunk |
| `nutrition.csv` | Food and drink entries with protein grams and calories; daily totals are summed from logged entries |
| `body-photos.csv` and `body-photos/` | Opt-in progress photo index, qualitative comparisons, and the original images |
| `records.md` | Your PR board |
| `memory.md` | Dated notes the coach saves from your conversations — travel, pain mentions, goals, life context — and reads back into coaching and nightly planning |
| `coach-plan.md` | The forward plan, regenerated nightly |

Each change has a dated event in SQLite. You don't have to write any of these files yourself — the `/init` command interviews you in Telegram and generates them. Existing users' GitHub files and photos are imported once on the first SQLite deployment; the old repos remain as migration archives.

## Setup

### 1. Create the Telegram bot (2 minutes)

1. In Telegram, message **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`.
2. Save the token it gives you (`123456:AAE...`) — this is `TELEGRAM_BOT_TOKEN`.
3. Open a chat with your new bot and send it any message (this matters — bots can't see you until you message first).
4. Get your numeric chat id: visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and read `result[0].message.chat.id`. That's `TELEGRAM_CHAT_ID`. The agent only ever talks to this one chat id — messages from anyone else are dropped.

### 2. Get a DeepSeek API key

Sign up at [platform.deepseek.com](https://platform.deepseek.com), add a small balance ($2 lasts months), create an API key. That's `DEEPSEEK_API_KEY`.

### 3. Deploy to Fly.io

Install [flyctl](https://fly.io/docs/flyctl/install/) and sign up (`flyctl auth login`; add a card — trial accounts stop idle machines, which silently kills the scheduled briefs).

```bash
git clone https://github.com/billbither/strength-coach.git && cd strength-coach
cp .env.example .env        # fill in every value; generate WEBHOOK_SECRET with: openssl rand -hex 24

# pick your own globally-unique app name in fly.toml ("app = ..."), then:
flyctl apps create <your-app-name>
flyctl volumes create coach_data -r ewr -s 1 --snapshot-retention 14 -a <your-app-name>
set -a; source .env; set +a
flyctl secrets set --stage \
  TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" \
  DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
  STORAGE_KEY="$STORAGE_KEY" \
  WEBHOOK_SECRET="$WEBHOOK_SECRET"
flyctl deploy --ha=false
```

Notes: the machine needs 512MB (already set in `fly.toml`; 256MB gets OOM-killed). `auto_stop_machines` is off on purpose — the cron schedules only fire while the process is alive. Cron times and the `America/New_York` timezone are set in `src/server.ts`; edit them there if you want different hours.

### 4. Point Telegram at your app

```bash
APP_URL=https://<your-app-name>.fly.dev node scripts/set-webhook.mjs
```

(Reads `TELEGRAM_BOT_TOKEN` and `WEBHOOK_SECRET` from your shell — `source .env` first if you opened a new terminal.) You should see `{"ok":true,...,"description":"Webhook was set"}`.

### 5. Initialize in Telegram

Message your bot: `/init`

The bot switches into setup mode and interviews you — name, age, height/weight, what you do and enjoy (lifting, running, cycling, classes), which of those you want programmed vs just logged, goals, equipment, injuries, schedule — one question at a time. When it has the picture, it confirms a summary with you, then saves the rulebook, equipment and activities files, program, empty logs, and PR board in SQLite. Once the files are written it switches back to coaching mode by itself — your next message goes to your coach.

If the machine restarts mid-interview (rare), just send `/init` again — it starts fresh.

## Daily use

Just talk to it:

- *"Did workout B today. Goblet squats 3x12 at 55, swings 4x25..."* → logged, PRs checked, safety-audited
- *"185.2 this morning, 14.1% body fat"* → logged with computed BMI
- *"Knocked out 20 pushups between meetings"* → tallied toward your weekly volume
- *"Lunch was a turkey sandwich, about 35 g protein and 500 calories"* → logged to `nutrition.csv`; the coach can total what you have logged today
- *"What should I do tomorrow?"* → answered from the nightly plan and your real history
- *"I bought 60 lb dumbbells"* → equipment.md updated; future programming uses them

### Smart scale reports

If your scale's app exports a PDF body-composition report (tested with the Oxiline Scale MD Pro), just **send the PDF to the bot** as a file. It extracts everything — weight, body fat %, muscle mass, skeletal muscle, BMR, visceral fat grade, body age, and segmental muscle/fat for each arm, each leg, and trunk — logs one row to `body.csv`, skips duplicates, and replies with a trend read (multi-entry trend, including per-segment muscle changes and left/right imbalance flags — not single-day noise). Workout data and body data live in strictly separate logs; both feed the coaching and the nightly plan.

Food photos are supported. Scale screenshots still need a PDF export for the full body-composition mapping. Malformed rows can't corrupt the logs: every append is validated against the CSV header before it is saved.

### Protein and calorie tracking

Tell the coach what you ate, or give it a protein or calorie total. It records one row per meal/item in `nutrition.csv` (`Date,Item,Protein (g),Calories,Notes`). You can report either metric or both; missing values remain blank. When quantities are estimated, the notes mark them as estimates. Ask "how much protein and how many calories have I logged today?" for a sum of the recorded entries. The dashboard shows daily totals and trends. Existing users get `nutrition.csv` automatically on their first nutrition log. A day with unreported meals is a partial log, not a complete intake total.

You can also send a food photo or a food/drink label, with an optional caption describing ingredients or portions. The bot estimates protein and calories from the image or calculates them from visible nutrition facts. If a key detail is unclear, it asks one question and waits for your answer before logging. It suggests placing a credit card **face down** beside unpackaged food only when the portion's physical size is hard to judge; it does not suggest one for labels or packages. Estimates remain approximate, especially for hidden ingredients, cooking oil, and food outside the frame. Images are sent to DeepSeek Flash vision for analysis; the food image itself is not saved.

### Body progress photos

Send `/bodyphoto` and then a front, side, or back photo, or send the photo with the caption `body photo`. For an uncaptioned photo that is not food, the bot asks whether to save it as a body photo; reply `body photo` to confirm. The first photo for each view is a baseline. Later photos are compared with the latest photo from the same view. Use similar pose, lighting, framing, and clothing for more useful comparisons. The bot describes visible differences cautiously; photos cannot measure muscle gain or body-fat change. The coach can use those observations alongside nutrition, training, and scale trends.

Body photos are sent to DeepSeek Flash for analysis and saved privately in SQLite; `body-photos.csv` records each photo and comparison. The image and its index are saved in one database transaction. Photos imported from a legacy GitHub repo remain in that repo's history too.

Commands:

| Command | What it does |
|---|---|
| `/brief` | Send the morning brief now (today's session, exact targets, volume status) |
| `/week` | Week-to-date volume vs targets |
| `/plan` | Re-run the deep planner now and get a digest |
| `/dashboard` | Send your live dashboard link |
| `/progress` | Review logged nutrition, strength training, and weight/muscle trends against your goals; get specific eating and training actions |
| `/bodyphoto` | Treat your next photo as a body progress photo and compare it with the latest matching view |
| `/letter` | Get your weekly coach's review now (also arrives automatically Sunday 6 PM) |
| `/init` | Enter setup mode (re-interview / rebuild stored coaching files); exits by itself once the files are written |
| `/done` | Abandon setup mode manually (rarely needed — e.g. quitting a half-finished interview) |

Scheduled (all times America/New_York, DST-aware): morning brief 7:00 AM, snack nudge 1:00 PM, nightly re-plan 2:00 AM, weekly coach's letter Sunday 6:00 PM (accountability review in your chosen coaching voice — set per user in coach-rules.md).

The coach now reviews nutrition, training performance, and multi-reading body trends together. The nightly plan and Sunday letter connect those observations to the goals in `coach-rules.md` and suggest specific eating and training adjustments. `/progress` runs that review on demand. Nutrition totals represent logged food only; incomplete days are not treated as full-day intake, and one scale muscle reading is not treated as a trend.

## Households: multiple people, one deployment

One bot and one Fly machine can coach several people. Each person needs their own **storage key** and Telegram **chat id**; they share the bot, machine, SQLite database, and DeepSeek key. Data is separated by storage key.

1. Have the new person open the bot and send it any message. Their chat id appears in the app logs: `flyctl logs` → "message from unconfigured chat id 123456789".
2. Set the `USERS` secret (replaces the single-user vars):

```bash
flyctl secrets set USERS='[
  {"chatId":"111111111","key":"you","name":"You"},
  {"chatId":"222222222","key":"partner","name":"Partner"}
]'
```

3. Kick off their onboarding for them — they never need to type a command. Either they send `/init` themselves, or you trigger it on their behalf:

```bash
source .env
curl -X POST "https://<your-app-name>.fly.dev/telegram/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $WEBHOOK_SECRET" \
  -d '{"message":{"chat":{"id":"<their-chat-id>"},"text":"/init"}}'
```

The interview starts in their Telegram immediately; when the bot finishes saving their data it switches to coaching mode by itself. Everyone gets their own briefs, nightly plan, history, and PR board; nobody sees anyone else's data in chat.

One caveat: interview progress lives in memory, so don't redeploy the app while someone is mid-interview — if it happens, just re-trigger `/init`.

## Migrating from the GitHub data repos

Existing `USERS` entries containing `repo` are recognized as legacy users. On the first start with an empty SQLite volume, the app reads every file and photo from each configured GitHub repo using the existing `GITHUB_TOKEN`, imports them in a transaction, verifies their bytes, and then starts serving Telegram. Keep that token through the first deployment. New writes go only to SQLite. Once the logs show every user migrated and the app is healthy, remove `GITHUB_TOKEN` from Fly secrets; later restarts use the SQLite volume and no longer need GitHub. Keep the old repos as migration archives.

New users use `key` in `USERS` and need no GitHub repo or token.

## Backup and recovery

Fly takes daily volume snapshots with 14-day retention for this app. For an independent copy, make a consistent SQLite backup and download it off the Fly machine:

```bash
flyctl ssh console -a <your-app-name> -C "npx tsx src/backup.ts /data/coach-backup.sqlite"
flyctl ssh sftp get /data/coach-backup.sqlite ./coach-backup.sqlite -a <your-app-name>
```

Keep that backup in a private location. A single Fly volume is one copy of the live data; Fly's scheduled snapshots may miss writes since the last snapshot. The volume cannot be shared across multiple app machines without adding database replication.

## Operations

```bash
flyctl logs -a <your-app-name>          # live logs
flyctl deploy --ha=false --strategy immediate  # redeploy the single-volume app
flyctl secrets set KEY=value            # rotate a secret (triggers restart)
flyctl volumes list -a <your-app-name>  # check persistent volume
```

The webhook rejects any request without your `WEBHOOK_SECRET` (Telegram sends it as a header on every delivery), and the agent ignores messages from any chat but yours. During a deploy there's a ~15 second restart window; Telegram retries deliveries automatically, so messages aren't lost.

## Architecture

```
Telegram ──webhook──▶ Hono server on Fly.io
  (text + PDF + photos) ├─ coach agent (deepseek-chat) ──┐
                        ├─ onboarder agent (/init)       ├──▶ SQLite on Fly volume (per-user keys)
                        ├─ PDF → pdftotext → coach       │    (logs, plans, photos)
                        ├─ food photo → Flash vision     │
                        ├─ body photo → Flash vision     │
                        ├─ cron 7:00 / 13:00  briefs     │
                        └─ cron 2:00  planner (deepseek-reasoner) ──▶ coach-plan.md
```

PDF parsing uses poppler's `pdftotext` (installed in the Docker image). Food photos use `deepseek-flash` through the DeepSeek vision API; `DEEPSEEK_VISION_MODEL` can override that model name.

Replies are plain text by design — Telegram doesn't render markdown, and a stripper in `src/telegram.ts` catches what the model leaks despite instructions (tested: instructions alone aren't enough).
