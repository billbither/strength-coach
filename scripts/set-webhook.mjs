// Point your Telegram bot's webhook at the deployed app.
// Usage: TELEGRAM_BOT_TOKEN=... WEBHOOK_SECRET=... APP_URL=https://your-app.fly.dev node scripts/set-webhook.mjs
const { TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, APP_URL } = process.env;
if (!TELEGRAM_BOT_TOKEN || !WEBHOOK_SECRET || !APP_URL) {
  console.error("Set TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET and APP_URL env vars first (see README).");
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${APP_URL.replace(/\/$/, "")}/telegram/webhook`,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message"],
  }),
});
console.log(await res.json());
