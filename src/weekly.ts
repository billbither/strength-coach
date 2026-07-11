import { Agent } from "@mastra/core/agent";
import { deepseek } from "@ai-sdk/deepseek";
import { readRepoFile, writeRepoFile } from "./github.js";
import { sendTelegram } from "./telegram.js";
import type { UserConfig } from "./users.js";

// The Sunday coach's letter: a weekly review on the reasoning model — accountability,
// trends, and next week's focus. Distinct from the planner: this looks BACKWARD.
const reviewer = new Agent({
  id: "weekly-reviewer",
  name: "weekly-reviewer",
  instructions: `You are the user's coach writing your weekly Sunday letter. You are given their complete training
data, body composition, memory notes, the current plan, and — critically — LAST week's letter with the commitments
you asked of them. coach-rules.md defines their profile, safety rules, targets, and COACHING VOICE — embody that
voice completely. If it says direct and demanding, be direct and demanding.

Write the letter with these sections (plain text, no markdown syntax — this goes to Telegram):

1. THE WEEK IN NUMBERS — sessions done vs planned, volume vs targets, body-comp deltas. Exact numbers.
2. ACCOUNTABILITY — go through every commitment from last week's letter: kept or missed, one line each, no
   softening. If there was no prior letter, say this is week one and baselines start now.
3. WHAT I SAW — 2-3 evidence-based observations from the log (patterns, wins worth celebrating, things sliding).
   PRs get real celebration. Sandbagging, skipped movements, or volume shortfalls get named plainly.
4. NEXT WEEK — the single focus that matters most, and 1-3 concrete commitments with numbers and deadlines
   ("100 pull-ups by Sunday", "log a weigh-in Wednesday morning fasted"). Make them binary — done or not done.
5. One closing line in their coach's voice.

Keep the whole letter under 40 lines. Never violate or encourage violating the safety rules in coach-rules.md —
a strong voice pushes effort and consistency, never through pain or past RIR floors.`,
  model: deepseek("deepseek-reasoner"),
});

const SOURCE_FILES = [
  "coach-rules.md",
  "strength-program.md",
  "workout-log.csv",
  "snacks.csv",
  "body.csv",
  "records.md",
  "coach-plan.md",
  "memory.md",
  "coach-letter.md",
] as const;

export async function runWeeklyReview(user: UserConfig): Promise<string> {
  const parts = await Promise.all(
    SOURCE_FILES.map(async (f) => {
      try {
        return `===== ${f}${f === "coach-letter.md" ? " (LAST week's letter)" : ""} =====\n${(await readRepoFile(user.repo, f)).content}`;
      } catch {
        return `===== ${f} =====\n(file not present)`;
      }
    }),
  );

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const result = await reviewer.generate(
    `Today is Sunday ${today}. Write this week's letter for ${user.name}.\n\n${parts.join("\n\n")}`,
    { maxSteps: 1 },
  );
  const letter = result.text?.trim();
  if (!letter) throw new Error("weekly review produced no text");

  let sha: string | undefined;
  try {
    sha = (await readRepoFile(user.repo, "coach-letter.md")).sha;
  } catch {
    // first letter
  }
  await writeRepoFile(user.repo, "coach-letter.md", letter + "\n", sha, `letter: week of ${today}`);
  await sendTelegram(user.chatId, letter);
  return letter;
}
