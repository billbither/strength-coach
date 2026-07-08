import { Hono } from "hono";
import { serve } from "@hono/node-server";
import cron from "node-cron";
import type { Agent } from "@mastra/core/agent";
import { makeCoach } from "./agent.js";
import { makeOnboarder } from "./onboarding.js";
import { sendTelegram } from "./telegram.js";
import { runBrief } from "./briefs.js";
import { runNightlyPlanning } from "./planner.js";
import { loadUsers, type UserConfig } from "./users.js";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

type ChatMsg = { role: "user"; content: string } | { role: "assistant"; content: string };

type UserSession = {
  config: UserConfig;
  coach: Agent;
  onboarder: Agent;
  history: ChatMsg[];
  onboarding: boolean;
  scaffolded: Set<string>;
};

// Onboarding is complete once these files have actually been written — no /done needed.
const SCAFFOLD_COMPLETE = ["coach-rules.md", "strength-program.md", "records.md"];

const sessions = new Map<string, UserSession>();
for (const config of loadUsers()) {
  const session: UserSession = {
    config,
    coach: makeCoach(config.repo, config.name),
    onboarder: makeOnboarder(config.repo, config.name, (file) => session.scaffolded.add(file)),
    history: [],
    onboarding: false,
    scaffolded: new Set(),
  };
  sessions.set(config.chatId, session);
}
console.log(`configured users: ${[...sessions.values()].map((s) => s.config.name).join(", ")}`);

function remember(s: UserSession, role: ChatMsg["role"], content: string) {
  s.history.push({ role, content } as ChatMsg);
  while (s.history.length > 20) s.history.shift();
}

const app = new Hono();

app.get("/health", (c) => c.text("ok"));

app.post("/telegram/webhook", async (c) => {
  if (c.req.header("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return c.text("forbidden", 403);
  }
  const update = await c.req.json<{ message?: { chat: { id: number }; text?: string } }>();
  const msg = update.message;
  // Always 200 so Telegram doesn't retry; silently drop non-text messages.
  if (!msg?.text) return c.json({ ok: true });

  const session = sessions.get(String(msg.chat.id));
  if (!session) {
    // Log unknown chat ids so adding a new user is easy: their id shows up here when they first message the bot.
    console.log(`message from unconfigured chat id ${msg.chat.id} — add it to USERS to enable`);
    return c.json({ ok: true });
  }

  handleMessage(session, msg.text.trim()).catch(async (err) => {
    console.error(`handleMessage failed for ${session.config.name}:`, err);
    await sendTelegram(session.config.chatId, "⚠️ Coach hit an error handling that — try again in a minute.").catch(
      () => {},
    );
  });
  return c.json({ ok: true });
});

async function handleMessage(s: UserSession, text: string) {
  if (text === "/init") {
    s.onboarding = true;
    s.scaffolded.clear();
    s.history.length = 0;
    const opening = await s.onboarder.generate(
      "A new user just sent /init. Greet them in one short plain-text message and ask your first interview question.",
      { maxSteps: 3 },
    );
    const msg = opening.text?.trim() || "Let's set you up. First: what's your name and age?";
    remember(s, "assistant", msg);
    await sendTelegram(s.config.chatId, msg);
    return;
  }
  if (text === "/done") {
    s.onboarding = false;
    s.history.length = 0;
    await sendTelegram(s.config.chatId, "Setup mode off — I'm your coach now. Try /brief for today's plan.");
    return;
  }
  if (text === "/brief") {
    await runBrief("morning", s.config, s.coach);
    return;
  }
  if (text === "/week") {
    await runBrief("snack", s.config, s.coach);
    return;
  }
  if (text === "/plan") {
    await sendTelegram(s.config.chatId, "Re-planning from your full history (reasoning model — takes a minute)...");
    await runNightlyPlanning(s.config);
    const summary = await s.coach.generate(
      "coach-plan.md was just regenerated. Read it and send me a plain-text digest: next session (every exercise/effort, " +
        "exact numbers), then one line each for the two sessions after, volume strategy, and watch items.",
      { maxSteps: 6 },
    );
    await sendTelegram(s.config.chatId, summary.text?.trim() || "Plan updated — committed to the repo.");
    return;
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const agent = s.onboarding ? s.onboarder : s.coach;
  remember(s, "user", text);
  const result = await agent.generate(
    [...s.history.slice(0, -1), { role: "user" as const, content: `(Today is ${today}.) ${text}` }],
    { maxSteps: 12 },
  );
  const reply = result.text?.trim() || "(no reply)";
  remember(s, "assistant", reply);
  await sendTelegram(s.config.chatId, reply);

  if (s.onboarding && SCAFFOLD_COMPLETE.every((f) => s.scaffolded.has(f))) {
    s.onboarding = false;
    s.scaffolded.clear();
    console.log(`onboarding complete for ${s.config.name} — switched to coaching mode`);
  }
}

function forEachUser(label: string, fn: (s: UserSession) => Promise<unknown>) {
  return () => {
    for (const s of sessions.values()) {
      fn(s).catch((e) => console.error(`${label} failed for ${s.config.name}:`, e));
    }
  };
}

// Daily schedules — timezone-aware (handles DST, unlike fixed-UTC cron).
cron.schedule("0 7 * * *", forEachUser("morning brief", (s) => runBrief("morning", s.config, s.coach)), {
  timezone: "America/New_York",
});
cron.schedule("0 13 * * *", forEachUser("snack nudge", (s) => runBrief("snack", s.config, s.coach)), {
  timezone: "America/New_York",
});
cron.schedule("0 2 * * *", forEachUser("nightly planning", (s) => runNightlyPlanning(s.config)), {
  timezone: "America/New_York",
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`strength-coach-agent listening on :${port}`);
