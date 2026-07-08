import { Agent } from "@mastra/core/agent";
import { deepseek } from "@ai-sdk/deepseek";
import { readRepoFile, writeRepoFile } from "./github.js";

// Long-horizon programming runs on the reasoning model; no tools — all context is inlined
// so this works regardless of the reasoner's function-calling support.
const planner = new Agent({
  id: "strength-planner",
  name: "strength-planner",
  instructions: `You are the overnight programming brain for the user's strength training. You are given their complete
training data and must produce the full contents of coach-plan.md: the rolling forward plan their day-to-day coach
and morning briefs follow.

The provided coach-rules.md defines their profile (age, body, injuries), hard safety rules, banned movements, volume
targets, deload policy, and progression scheme. Obey every rule in it absolutely — when anything is ambiguous,
program conservatively (this is an unsupervised plan for a real person). Default policies when coach-rules.md is silent:
double progression (top of rep range on all sets before adding load), deload every 5-6 weeks, nothing to failure
on unspotted barbell lifts.

The plan must be grounded in what they ACTUALLY did (workout-log.csv, snacks.csv) — not the idealized program.
Look for patterns: skipped exercises, grip limitations, ordering problems, stalled lifts, volume shortfalls,
recovery signals, and adjust the plan to fix them. Body-composition trends (body.csv) inform recovery notes.

Output format: ONLY the complete markdown content of coach-plan.md — no preamble, no code fences around the whole
document. Structure it as:
# Coach Plan (updated YYYY-MM-DD)
## Where you are  (rotation state, weeks since deload, one-paragraph read of the last 2 weeks)
## Next 3 sessions  (each: Builder letter, every exercise with exact sets x reps x weight and RIR, ordering notes)
## This week's volume strategy  (what to snack and roughly when, to hit the weekly targets)
## Watch items  (specific, evidence-based: e.g. grip fatigue ordering, shoulder monitoring, stalled lifts)
## Deload countdown  (weeks until due; what the deload week will look like when it arrives)
Keep it under ~120 lines. Exact numbers everywhere — this file is what the daily coach quotes.`,
  model: deepseek("deepseek-reasoner"),
});

const SOURCE_FILES = [
  "strength-program.md",
  "coach-rules.md",
  "workout-log.csv",
  "snacks.csv",
  "body.csv",
  "records.md",
] as const;

export async function runNightlyPlanning(): Promise<string> {
  const parts = await Promise.all(
    SOURCE_FILES.map(async (f) => `===== ${f} =====\n${(await readRepoFile(f)).content}`),
  );

  let currentPlan = "(no coach-plan.md yet — this is the first run)";
  let sha: string | undefined;
  try {
    const existing = await readRepoFile("coach-plan.md");
    currentPlan = existing.content;
    sha = existing.sha;
  } catch {
    // first run: file doesn't exist yet
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const result = await planner.generate(
    `Today is ${today}.\n\n${parts.join("\n\n")}\n\n===== current coach-plan.md =====\n${currentPlan}\n\n` +
      `Write the new complete coach-plan.md.`,
    { maxSteps: 1 },
  );

  const plan = result.text?.trim();
  if (!plan || !plan.startsWith("#")) throw new Error(`planner returned unusable output: ${plan?.slice(0, 120)}`);

  await writeRepoFile("coach-plan.md", plan + "\n", sha, `plan: ${today} nightly programming update`);
  return plan;
}
