import { Hono } from "hono";
import { serve } from "@hono/node-server";
import cron from "node-cron";
import { coach } from "./agent.js";
import { onboarder } from "./onboarding.js";
import { sendTelegram } from "./telegram.js";
import { runBrief } from "./briefs.js";
import { runNightlyPlanning } from "./planner.js";

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

// Onboarding mode: /init flips the conversation to the interviewer agent until /done.
// In-memory by design — if the machine restarts mid-interview, just send /init again.
let onboardingMode = false;

async function handleMessage(text: string) {
  if (text === "/init") {
    onboardingMode = true;
    history.length = 0;
    const opening = await onboarder.generate(
      "A new user just sent /init. Greet them in one short plain-text message and ask your first interview question.",
      { maxSteps: 3 },
    );
    const msg = opening.text?.trim() || "Let's set you up. First: what's your name and age?";
    remember("assistant", msg);
    await sendTelegram(OWNER_CHAT_ID, msg);
    return;
  }
  if (text === "/done") {
    onboardingMode = false;
    history.length = 0;
    await sendTelegram(OWNER_CHAT_ID, "Setup mode off — I'm your coach now. Try /brief for today's plan.");
    return;
  }
  if (text === "/brief") {
    await runBrief("morning");
    return;
  }
  if (text === "/week") {
    await runBrief("snack");
    return;
  }
  if (text === "/plan") {
    await sendTelegram(OWNER_CHAT_ID, "Re-planning from your full history (reasoning model — takes a minute)...");
    await runNightlyPlanning();
    const summary = await coach.generate(
      "coach-plan.md was just regenerated. Read it and send me a plain-text digest: next session (every exercise, " +
        "exact numbers), then one line each for the two sessions after, volume strategy, and watch items.",
      { maxSteps: 6 },
    );
    await sendTelegram(OWNER_CHAT_ID, summary.text?.trim() || "Plan updated — committed to the repo.");
    return;
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const agent = onboardingMode ? onboarder : coach;
  remember("user", text);
  const result = await agent.generate(
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
cron.schedule("0 2 * * *", () => runNightlyPlanning().catch((e) => console.error("nightly planning failed:", e)), {
  timezone: "America/New_York",
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`strength-coach-agent listening on :${port}`);
