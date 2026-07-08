import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appendRepoFile, readRepoFile, writeRepoFile } from "./github.js";

const TRAINING_FILES = [
  "strength-program.md",
  "CLAUDE.md",
  "workout-log.csv",
  "snacks.csv",
  "body.csv",
  "records.md",
  "coach-plan.md",
] as const;

export const readTrainingFile = createTool({
  id: "read_training_file",
  description:
    "Read one of the training source-of-truth files from the strength-training GitHub repo. " +
    "strength-program.md = the program; CLAUDE.md = coaching rules; workout-log.csv = full workout history; " +
    "snacks.csv = movement-snack tally; body.csv = weigh-ins; records.md = PR board; " +
    "coach-plan.md = the current forward plan (next sessions with exact targets), regenerated nightly.",
  inputSchema: z.object({
    file: z.enum(TRAINING_FILES),
  }),
  execute: async ({ file }) => {
    const { content } = await readRepoFile(file);
    return content;
  },
});

export const appendLogRows = createTool({
  id: "append_log_rows",
  description:
    "Append one or more CSV rows to a training log file and commit+push (append-only; never rewrites existing rows). " +
    "workout-log.csv columns: Date,Day,Workout,Exercise,Sets x Reps,Weight,RIR/Effort,Notes. " +
    "snacks.csv columns: Date,Movement,Amount,Unit,Notes (Unit is reps or sec). " +
    "body.csv columns: Date,Weight (lb),Body Fat %,Muscle Mass (lb),BMI,Notes. " +
    "Use ISO dates (YYYY-MM-DD) and quote any field containing a comma.",
  inputSchema: z.object({
    file: z.enum(["workout-log.csv", "snacks.csv", "body.csv"]),
    rows: z.array(z.string()).min(1).describe("Complete CSV rows, no header, no trailing newline"),
    commitMessage: z
      .string()
      .describe('Commit message, e.g. "log: 2026-07-08 Builder C" or "snacks: 2026-07-08" or "weigh-in: 2026-07-08"'),
  }),
  execute: async ({ file, rows, commitMessage }) => {
    await appendRepoFile(file, rows, commitMessage);
    return `Appended ${rows.length} row(s) to ${file} and pushed.`;
  },
});

export const writeTrainingFile = createTool({
  id: "write_training_file",
  description:
    "Create or completely overwrite one of the training files in the data repo and commit+push. " +
    "Used during onboarding to scaffold a new user's repo (CLAUDE.md, strength-program.md, CSV headers, records.md). " +
    "For day-to-day logging use append_log_rows instead — this tool replaces the whole file.",
  inputSchema: z.object({
    file: z.enum(TRAINING_FILES),
    content: z.string().describe("The complete file content"),
    commitMessage: z.string().describe('e.g. "init: coaching rules" or "init: program"'),
  }),
  execute: async ({ file, content, commitMessage }) => {
    let sha: string | undefined;
    try {
      sha = (await readRepoFile(file)).sha;
    } catch {
      // new file
    }
    await writeRepoFile(file, content, sha, commitMessage);
    return `${file} written and pushed.`;
  },
});

export const updateRecords = createTool({
  id: "update_records",
  description:
    "Overwrite records.md (the PR board) with new full markdown content and commit+push. " +
    "Read records.md first, modify only the lines that changed, and pass back the complete file.",
  inputSchema: z.object({
    content: z.string().describe("The complete new records.md content"),
    commitMessage: z.string().describe('Commit message, e.g. "records: bench PR 140x8"'),
  }),
  execute: async ({ content, commitMessage }) => {
    const { sha } = await readRepoFile("records.md");
    await writeRepoFile("records.md", content, sha, commitMessage);
    return "records.md updated and pushed.";
  },
});
