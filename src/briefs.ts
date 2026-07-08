import { coach } from "./agent.js";
import { sendTelegram } from "./telegram.js";

function todayLine(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const MORNING_PROMPT = () => `Good morning — today is ${todayLine()}. Build my daily check-in brief.
Read strength-program.md, CLAUDE.md, workout-log.csv, snacks.csv, body.csv and records.md first, then send a short,
scannable brief (not an essay):

1. TODAY'S PLAN — from my most recent logged session and the A -> B -> C rotation, which Builder is up next, or is
   today a rest/active-recovery day? If I trained hard yesterday, protect recovery. Flag a deload if I'm at week 5-6.
2. PROGRESSION TARGETS — exact targets (weight x reps, RIR) for each main lift in today's Builder from my latest log
   numbers and the double-progression rules. Flag earned load bumps. Enforce the shoulder rules.
3. MOVEMENT SNACK — one easy snack for today (opposite of today's builder focus), never to failure.
4. WEEKLY VOLUME — one-line week-to-date read: pull-ups and push-ups vs weekly targets, KB swings month-to-date vs
   target. If today is Sunday, give the full weekly roll-up plus a body-composition trend from body.csv instead.
If I haven't weighed in for a while, gently prompt (don't nag). End by reminding me to just message you what I did
and you'll log it. This is a read-only run: do NOT append or modify any files.`;

const SNACK_PROMPT = () => `It's snack-nudge time on ${todayLine()}. Read CLAUDE.md, snacks.csv and workout-log.csv,
compute week-to-date (Mon-Sun) totals from BOTH files: pull-ups vs 100-150/week, push-ups vs 200-300/week, and
KB swings month-to-date vs 500-1,000/month. Reply in 3-4 lines max: each number vs target with a one-word read,
then ONE concrete snack to do right now sized to the biggest gap (never to failure). Encouraging, not naggy — if
everything is on pace, one line and make the snack optional. End with a reminder that I can just message you what
I did and it gets logged. Read-only run: do NOT append or modify any files.`;

export async function runBrief(kind: "morning" | "snack"): Promise<string> {
  const prompt = kind === "morning" ? MORNING_PROMPT() : SNACK_PROMPT();
  const result = await coach.generate(prompt, { maxSteps: 12 });
  const text = result.text?.trim() || "(coach produced no text)";
  await sendTelegram(process.env.TELEGRAM_CHAT_ID!, text);
  return text;
}
