import { Hono } from "hono";
import { serve } from "@hono/node-server";
import cron from "node-cron";
import type { Agent } from "@mastra/core/agent";
import { makeCoach } from "./agent.js";
import { makeOnboarder } from "./onboarding.js";
import { downloadTelegramFile, sendTelegram } from "./telegram.js";
import { pdfToText } from "./pdf.js";
import { finalText } from "./text.js";
import { runBrief } from "./briefs.js";
import { runNightlyPlanning } from "./planner.js";
import { runWeeklyReview } from "./weekly.js";
import { loadUsers, type UserConfig } from "./users.js";
import { renderDashboard } from "./dashboard.js";
import { createHash } from "node:crypto";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;
const APP_URL = process.env.APP_URL ?? (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : "http://localhost:8080");

type ChatMsg = { role: "user"; content: string } | { role: "assistant"; content: string };

type UserSession = {
  config: UserConfig;
  coach: Agent;
  onboarder: Agent;
  history: ChatMsg[];
  onboarding: boolean;
  scaffolded: Set<string>;
  replanTimer?: ReturnType<typeof setTimeout>;
};

// Onboarding is complete once these files have actually been written — no /done needed.
const SCAFFOLD_COMPLETE = ["coach-rules.md", "strength-program.md", "records.md"];

const sessions = new Map<string, UserSession>();
for (const config of loadUsers()) {
  const session: UserSession = {
    config,
    coach: makeCoach(config.repo, config.name, `${APP_URL}/dashboard/${dashboardToken(config.chatId)}`, (file) => {
      if (file === "workout-log.csv") scheduleReplan(session);
    }),
    onboarder: makeOnboarder(config.repo, config.name, (file) => session.scaffolded.add(file)),
    history: [],
    onboarding: false,
    scaffolded: new Set(),
  };
  sessions.set(config.chatId, session);
}
console.log(`configured users: ${[...sessions.values()].map((s) => s.config.name).join(", ")}`);

// A logged workout makes the plan stale — re-plan automatically, debounced so a session
// logged across several messages triggers one replan, a few minutes after the last row.
function scheduleReplan(s: UserSession) {
  if (s.replanTimer) clearTimeout(s.replanTimer);
  s.replanTimer = setTimeout(() => {
    console.log(`auto-replan for ${s.config.name} (workout logged)`);
    runNightlyPlanning(s.config).catch((e) => console.error(`auto-replan failed for ${s.config.name}:`, e));
  }, 3 * 60 * 1000);
}

function remember(s: UserSession, role: ChatMsg["role"], content: string) {
  s.history.push({ role, content } as ChatMsg);
  while (s.history.length > 20) s.history.shift();
}

const app = new Hono();

app.get("/health", (c) => c.text("ok"));

// Per-user dashboard behind an unguessable token (derived, so no new secrets to manage).
function dashboardToken(chatId: string): string {
  return createHash("sha256").update(`${WEBHOOK_SECRET}:dashboard:${chatId}`).digest("hex").slice(0, 20);
}

app.get("/dashboard/:token", async (c) => {
  const token = c.req.param("token");
  const session = [...sessions.values()].find((s) => dashboardToken(s.config.chatId) === token);
  if (!session) return c.text("not found", 404);
  try {
    c.header("Cache-Control", "no-store, must-revalidate");
    return c.html(await renderDashboard(session.config));
  } catch (err) {
    console.error(`dashboard render failed for ${session.config.name}:`, err);
    return c.text("dashboard error — check logs", 500);
  }
});

app.post("/telegram/webhook", async (c) => {
  if (c.req.header("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return c.text("forbidden", 403);
  }
  const update = await c.req.json<{
    message?: {
      chat: { id: number };
      text?: string;
      caption?: string;
      document?: { file_id: string; mime_type?: string; file_name?: string };
      photo?: { file_id: string }[];
    };
  }>();
  const msg = update.message;
  if (!msg) return c.json({ ok: true }); // always 200 so Telegram doesn't retry

  const session = sessions.get(String(msg.chat.id));
  if (!session) {
    // Log unknown chat ids so adding a new user is easy: their id shows up here when they first message the bot.
    console.log(`message from unconfigured chat id ${msg.chat.id} — add it to USERS to enable`);
    return c.json({ ok: true });
  }

  const work = msg.document?.mime_type === "application/pdf"
    ? handlePdf(session, msg.document.file_id, msg.caption)
    : msg.photo?.length
      ? sendTelegram(
          session.config.chatId,
          "I can't read photos yet — but if that's a scale report, export the PDF from the scale app and send that file instead. PDFs I can read and log.",
        )
      : msg.text
        ? handleMessage(session, msg.text.trim())
        : Promise.resolve();

  work.catch(async (err) => {
    console.error(`handling failed for ${session.config.name}:`, err);
    await sendTelegram(session.config.chatId, "⚠️ Coach hit an error handling that — try again in a minute.").catch(
      () => {},
    );
  });
  return c.json({ ok: true });
});

async function handlePdf(s: UserSession, fileId: string, caption?: string) {
  const pdf = await downloadTelegramFile(fileId);
  const text = (await pdfToText(pdf)).trim();
  if (!text) {
    await sendTelegram(s.config.chatId, "That PDF has no readable text — I couldn't extract anything from it.");
    return;
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const prompt =
    `(Today is ${today}.) I'm sending you a document — extracted text below` +
    (caption ? ` (my note: "${caption}")` : "") +
    `. If it's a body-composition / scale report: read body.csv FIRST to get its exact header, then append ONE row ` +
    `to body.csv ONLY — never to workout-log.csv (body stats and workouts are separate logs). Fill every column the ` +
    `report provides (including segmental muscle/fat per arm, leg and trunk from the Muscle Balance and Segmental ` +
    `Fat sections), leave columns the report lacks empty, keep the exact column count, and double-quote any field ` +
    `containing commas. coach-rules.md documents the full report-to-column mapping. Also check I haven't already ` +
    `logged a row for the same date+time — if this looks like a duplicate of the latest row, say so and DON'T log ` +
    `it again. Then read my body.csv history and give me a short trend read (multi-entry trend, not single-day ` +
    `noise) focused on muscle mass — total and per-segment — and body fat. ` +
    `Update records.md body bests if this beats them. If it's some other kind of training document, do the sensible ` +
    `equivalent (log it or summarize it). Reply with a short plain-text summary of what you logged.\n\n` +
    `--- DOCUMENT TEXT ---\n${text.slice(0, 12000)}`;
  remember(s, "user", `(sent a PDF document${caption ? `: ${caption}` : ""})`);
  const result = await s.coach.generate(prompt, { maxSteps: 12 });
  const reply = finalText(result);
  remember(s, "assistant", reply);
  await sendTelegram(s.config.chatId, reply);
}

async function handleMessage(s: UserSession, text: string) {
  if (text === "/init") {
    s.onboarding = true;
    s.scaffolded.clear();
    s.history.length = 0;
    const opening = await s.onboarder.generate(
      "A new user just sent /init. Greet them in one short plain-text message and ask your first interview question.",
      { maxSteps: 3 },
    );
    const msg = finalText(opening, "Let's set you up. First: what's your name and age?");
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
  if (text === "/dashboard") {
    await sendTelegram(s.config.chatId, `Your live dashboard: ${APP_URL}/dashboard/${dashboardToken(s.config.chatId)}`);
    return;
  }
  if (text === "/letter") {
    await sendTelegram(s.config.chatId, "Writing your weekly review (reasoning model — takes a minute)...");
    await runWeeklyReview(s.config);
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
    await sendTelegram(s.config.chatId, finalText(summary, "Plan updated — committed to the repo."));
    return;
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const agent = s.onboarding ? s.onboarder : s.coach;
  remember(s, "user", text);
  const result = await agent.generate(
    [...s.history.slice(0, -1), { role: "user" as const, content: `(Today is ${today}.) ${text}` }],
    { maxSteps: 12 },
  );
  const reply = finalText(result);
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
cron.schedule("0 18 * * 0", forEachUser("weekly review", (s) => runWeeklyReview(s.config)), {
  timezone: "America/New_York",
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`strength-coach-agent listening on :${port}`);
