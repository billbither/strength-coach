import type { Agent } from "@mastra/core/agent";
import { sendTelegram } from "./telegram.js";
import { finalText } from "./text.js";
import type { UserConfig } from "./users.js";

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
Read coach-plan.md (the nightly forward plan — your primary source for today's session and targets), plus
coach-rules.md, memory.md (recent context — travel, pain, schedule), workout-log.csv, snacks.csv, body.csv, nutrition.csv (if present) and records.md, then send a short, scannable brief (not an
essay; strictly plain text — no markdown):

0. LAYOFF CHECK — do this first, from the dates in workout-log.csv: how many days since my last logged session, and
   how many snacks logged since it. If it's 4 or more days, the brief OPENS with that number in the coaching voice
   from coach-rules.md — blunt, no softening, ask what happened — and today's session is non-negotiable: never
   propose a rest day after a layoff, even if coach-plan.md says REST (the plan is stale; the next session in
   rotation is today's). Under 4 days: skip this section entirely and say nothing about it.
1. TODAY'S PLAN — from the plan, my recent logged sessions, and my program's rotation/schedule: what's on today
   (which session, a run, a class, or a rest/active-recovery day)? If I trained hard yesterday, protect recovery.
   Flag a deload if one is near per my rules. If coach-rules.md defines home/away modes, lead this section with
   today's mode and this week's session count vs that mode's target (e.g. "HOME week: 1 of 4 done") — if the
   week is on track to miss, say what has to move to fix it.
2. TARGETS — exact targets for today's session from the plan and my latest numbers (weight x reps + RIR for lifts;
   distance/duration/intensity for cardio). Flag earned progressions. Enforce every safety rule in coach-rules.md.
3. MOVEMENT SNACK — one easy snack for today (complementary to today's focus), never to failure.
4. WEEKLY VOLUME — one-line week-to-date read of whatever targets coach-rules.md defines (rep volume, mileage,
   classes). If today is Sunday, give the full weekly roll-up plus a body-composition trend from body.csv instead.
   If a nutrition target is defined and intake was logged yesterday, add a one-line protein/calorie read; label
   unconfirmed or partial days as "logged" rather than claiming that was all they consumed.
If I haven't weighed in for a while, gently prompt (don't nag). End with the closing ask coach-rules.md specifies
for the brief if it defines one (e.g. asking for yesterday's snack tally); otherwise end by reminding me to just
message you what I did and you'll log it. This is a read-only run: do NOT append or modify any files.
LENGTH AND TONE: 15 lines maximum. No preamble, no narration of what you're reading or thinking — start directly
with section 1. Numbers, not sentences, wherever possible.`;

const SNACK_PROMPT = () => `It's snack-nudge time on ${todayLine()}. Read coach-rules.md, snacks.csv and
workout-log.csv, and compute week-to-date (Mon-Sun) totals from BOTH files for whatever weekly/monthly targets
coach-rules.md defines (movement-snack rep counts, run mileage, class counts...). Reply in 3-4 lines max: each
number vs target with a one-word read (on pace / behind / ahead), then ONE concrete thing to do right now sized to
the biggest gap (never to failure). Encouraging, not naggy — if everything is on pace, one line and make it
optional. If no targets are defined, send nothing more than one friendly movement reminder. End with a reminder
that I can just message you what I did and it gets logged. Read-only run: do NOT append or modify any files.`;

export async function runBrief(kind: "morning" | "snack", user: UserConfig, coach: Agent): Promise<string> {
  const prompt = kind === "morning" ? MORNING_PROMPT() : SNACK_PROMPT();
  const result = await coach.generate(prompt, { maxSteps: 12 });
  const text = finalText(result, "(coach produced no text)");
  await sendTelegram(user.chatId, text);
  return text;
}
