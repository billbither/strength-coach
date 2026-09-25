export const NUTRITION_HEADER = "Date,Item,Protein (g),Calories,Notes";

import { appendRepoFile, readRepoFile, writeRepoFile } from "./github.js";

export type NutritionEntry = {
  date: string;
  item: string;
  proteinG?: number;
  calories?: number;
  notes?: string;
};

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function nutritionRow(entry: NutritionEntry): string {
  const parsedDate = new Date(`${entry.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== entry.date) {
    throw new Error("Nutrition date must be a valid ISO date (YYYY-MM-DD).");
  }
  if (!entry.item.trim() || /[\r\n]/.test(entry.item) || /[\r\n]/.test(entry.notes ?? "")) {
    throw new Error("Nutrition item is required; item and notes must each be one line.");
  }
  if (entry.proteinG === undefined && entry.calories === undefined) {
    throw new Error("Provide protein grams, calories, or both for each nutrition entry.");
  }
  for (const [name, value] of [["Protein", entry.proteinG], ["Calories", entry.calories]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${name} must be a nonnegative number.`);
  }
  return [entry.date, csvCell(entry.item.trim()), entry.proteinG ?? "", entry.calories ?? "", csvCell(entry.notes?.trim() ?? "")].join(",");
}

export async function appendNutritionEntries(repo: string, entries: NutritionEntry[], commitMessage: string): Promise<string> {
  if (!entries.length) throw new Error("At least one nutrition entry is required.");
  const rows = entries.map(nutritionRow);
  try {
    const existing = await readRepoFile(repo, "nutrition.csv");
    if (existing.content.split("\n")[0] !== NUTRITION_HEADER) {
      throw new Error(`nutrition.csv has an unexpected header: ${existing.content.split("\n")[0]}`);
    }
    await appendRepoFile(repo, "nutrition.csv", rows, commitMessage);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("nutrition.csv failed: 404 ")) throw error;
    try {
      await writeRepoFile(repo, "nutrition.csv", `${NUTRITION_HEADER}\n${rows.join("\n")}\n`, undefined, commitMessage);
    } catch (writeError) {
      if (!(writeError instanceof Error) || !writeError.message.includes("nutrition.csv failed: 422 ")) throw writeError;
      await appendRepoFile(repo, "nutrition.csv", rows, commitMessage);
    }
  }
  return `Appended ${rows.length} row(s) to nutrition.csv and pushed.`;
}
