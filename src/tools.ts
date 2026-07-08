import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appendRepoFile, readRepoFile, writeRepoFile } from "./github.js";

export const TRAINING_FILES = [
  "strength-program.md",
  "coach-rules.md",
  "equipment.md",
  "activities.md",
  "workout-log.csv",
  "snacks.csv",
  "body.csv",
  "records.md",
  "coach-plan.md",
] as const;

// Tools are created per user, bound to that user's data repo.
// onScaffoldWrite (optional) is called with the filename whenever write_training_file commits a file —
// the server uses it to detect when onboarding has finished scaffolding the repo.
export function makeTools(repo: string, onScaffoldWrite?: (file: string) => void) {
  const readTrainingFile = createTool({
    id: "read_training_file",
    description:
      "Read one of the training source-of-truth files from the user's data repo. " +
      "strength-program.md = the training program (all modalities); coach-rules.md = the coaching rulebook; " +
      "equipment.md = available equipment and access; activities.md = activities they do/enjoy (cardio favorites, " +
      "classes, sports) and whether each is programmed or just logged; " +
      "workout-log.csv = full training history (lifting, runs, rides, classes); snacks.csv = movement-snack tally; " +
      "body.csv = weigh-ins; records.md = PR board; coach-plan.md = the forward plan, regenerated nightly.",
    inputSchema: z.object({
      file: z.enum(TRAINING_FILES),
    }),
    execute: async ({ file }) => {
      const { content } = await readRepoFile(repo, file);
      return content;
    },
  });

  const appendLogRows = createTool({
    id: "append_log_rows",
    description:
      "Append one or more CSV rows to a training log file and commit+push (append-only; never rewrites existing rows). " +
      "The exact column conventions are documented in coach-rules.md — follow them. Defaults: " +
      "workout-log.csv = Date,Day,Workout,Exercise,Sets x Reps,Weight,RIR/Effort,Notes (cardio/classes fit too, e.g. " +
      'Exercise "Run", Sets x Reps "1 x 5 mi", Weight "Bodyweight", RIR/Effort "RPE 6"). ' +
      "snacks.csv = Date,Movement,Amount,Unit,Notes. body.csv = Date,Weight (lb),Body Fat %,Muscle Mass (lb),BMI,Notes. " +
      "Use ISO dates (YYYY-MM-DD) and quote any field containing a comma.",
    inputSchema: z.object({
      file: z.enum(["workout-log.csv", "snacks.csv", "body.csv"]),
      rows: z.array(z.string()).min(1).describe("Complete CSV rows, no header, no trailing newline"),
      commitMessage: z
        .string()
        .describe('Commit message, e.g. "log: 2026-07-08 Builder C" or "snacks: 2026-07-08" or "weigh-in: 2026-07-08"'),
    }),
    execute: async ({ file, rows, commitMessage }) => {
      await appendRepoFile(repo, file, rows, commitMessage);
      return `Appended ${rows.length} row(s) to ${file} and pushed.`;
    },
  });

  const writeTrainingFile = createTool({
    id: "write_training_file",
    description:
      "Create or completely overwrite one of the training files in the data repo and commit+push. " +
      "Used during onboarding to scaffold a new user's repo (coach-rules.md, strength-program.md, CSV headers, records.md). " +
      "For day-to-day logging use append_log_rows instead — this tool replaces the whole file.",
    inputSchema: z.object({
      file: z.enum(TRAINING_FILES),
      content: z.string().describe("The complete file content"),
      commitMessage: z.string().describe('e.g. "init: coaching rules" or "init: program"'),
    }),
    execute: async ({ file, content, commitMessage }) => {
      let sha: string | undefined;
      try {
        sha = (await readRepoFile(repo, file)).sha;
      } catch {
        // new file
      }
      await writeRepoFile(repo, file, content, sha, commitMessage);
      onScaffoldWrite?.(file);
      return `${file} written and pushed.`;
    },
  });

  const updateProfileFile = createTool({
    id: "update_settings_file",
    description:
      "Overwrite equipment.md, activities.md, strength-program.md or coach-rules.md with updated full content and " +
      "commit+push. Equipment/activities: update freely when the user mentions changes ('bought 60 lb dumbbells'). " +
      "Program/rules: ONLY when the user explicitly asks for a program or rule change, and only AFTER you have " +
      "described the exact change back to them and they confirmed. Always read the current file first, apply the " +
      "minimal change, pass back the complete file.",
    inputSchema: z.object({
      file: z.enum(["equipment.md", "activities.md", "strength-program.md", "coach-rules.md"]),
      content: z.string().describe("The complete new file content"),
      commitMessage: z.string().describe('e.g. "equipment: add 60 lb dumbbells" or "program: swap split squats for lunges"'),
    }),
    execute: async ({ file, content, commitMessage }) => {
      let sha: string | undefined;
      try {
        sha = (await readRepoFile(repo, file)).sha;
      } catch {
        // file may not exist yet
      }
      await writeRepoFile(repo, file, content, sha, commitMessage);
      return `${file} updated and pushed.`;
    },
  });

  const updateRecords = createTool({
    id: "update_records",
    description:
      "Overwrite records.md (the PR board) with new full markdown content and commit+push. " +
      "Read records.md first, modify only the lines that changed, and pass back the complete file.",
    inputSchema: z.object({
      content: z.string().describe("The complete new records.md content"),
      commitMessage: z.string().describe('Commit message, e.g. "records: bench PR 140x8"'),
    }),
    execute: async ({ content, commitMessage }) => {
      const { sha } = await readRepoFile(repo, "records.md");
      await writeRepoFile(repo, "records.md", content, sha, commitMessage);
      return "records.md updated and pushed.";
    },
  });

  return { readTrainingFile, appendLogRows, writeTrainingFile, updateRecords, updateProfileFile };
}
