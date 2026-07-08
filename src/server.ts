import { Hono } from "hono";
import { serve } from "@hono/node-server";
import cron from "node-cron";
import { coach } from "./agent.js";
import { sendTelegram } from "./telegram.js";
import { runBrief } from "./briefs.js";

const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

// Short rolling conversation memory so follow-up questions have context.
type ChatMsg = { role: "user"; content: string } | { role: "assistant"; content: string };
const history: ChatMsg[] = [];
function remember(role: ChatMsg["role"], content: string) {
  history.push({ role, content } as ChatMsg);
  while (history.length > 20) history.shift();
}

const app = new Hono();

app.get("/health", (c) => c.text("ok"));

app.post("/telegram/webhook", async (c) => {
  if (c.req.header("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return c.text("forbidden", 403);
  }
  const update = await c.req.json<{ message?: { chat: { id: number }; text?: string } }>();
  const msg = update.message;
  // Always 200 so Telegram doesn't retry; silently drop non-owner and non-text messages.
  if (!msg?.text || String(msg.chat.id) !== OWNER_CHAT_ID) return c.json({ ok: true });

  const text = msg.text.trim();
  handleMessage(text).catch(async (err) => {
    console.error("handleMessage failed:", err);
    await sendTelegram(OWNER_CHAT_ID, "⚠️ Coach hit an error handling that — try again in a minute.").catch(() => {});
  });
  return c.json({ ok: true });
});

async function handleMessage(text: string) {
  if (text === "/brief") {
    await runBrief("morning");
    return;
  }
  if (text === "/week") {
    await runBrief("snack");
    return;
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  remember("user", text);
  const result = await coach.generate(
    [
      ...history.slice(0, -1),
      { role: "user" as const, content: `(Today is ${today}.) ${text}` },
    ],
    { maxSteps: 12 },
  );
  const reply = result.text?.trim() || "(no reply)";
  remember("assistant", reply);
  await sendTelegram(OWNER_CHAT_ID, reply);
}

// Daily briefs — timezone-aware (handles DST, unlike fixed-UTC cron).
cron.schedule("0 7 * * *", () => runBrief("morning").catch((e) => console.error("morning brief failed:", e)), {
  timezone: "America/New_York",
});
cron.schedule("0 13 * * *", () => runBrief("snack").catch((e) => console.error("snack nudge failed:", e)), {
  timezone: "America/New_York",
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`strength-coach-agent listening on :${port}`);
