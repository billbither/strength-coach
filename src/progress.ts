type Row = Record<string, string>;

// Parse quoted commas, escaped quotes, and quoted newlines in the repo's CSV logs.
export function csvObjects(content: string): Row[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (quoted && content[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      record.push(field.trim()); field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      record.push(field.trim()); field = "";
      if (record.some(Boolean)) records.push(record);
      record = [];
    } else field += ch;
  }
  record.push(field.trim());
  if (record.some(Boolean)) records.push(record);
  const [header, ...data] = records;
  return header ? data.map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""]))) : [];
}

function number(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dayIndex(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}

function average(values: number[]): string {
  return values.length
    ? `${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} lb (${values.length} ${values.length === 1 ? "day" : "days"})`
    : "no readings";
}

export function buildProgressSnapshot(
  files: { nutrition?: string; body?: string; workout?: string },
  today: string,
): string {
  const todayIndex = dayIndex(today);
  if (todayIndex === null) throw new Error(`Invalid snapshot date: ${today}`);
  const inWindow = (date: string, start: number, end: number) => {
    const index = dayIndex(date);
    return index !== null && index >= todayIndex - start && index <= todayIndex - end;
  };

  const nutrition = csvObjects(files.nutrition ?? "");
  const daily = new Map<string, { protein: number; calories: number; proteinSeen: boolean; caloriesSeen: boolean; entries: number }>();
  const itemCounts = new Map<string, { date: string; item: string; count: number }>();
  for (const row of nutrition) {
    if (!inWindow(row.Date ?? "", 6, 0)) continue;
    const item = (row.Item ?? "").replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
    if (item) {
      const key = `${row.Date}|${item}`;
      const count = itemCounts.get(key) ?? { date: row.Date, item, count: 0 };
      count.count++;
      itemCounts.set(key, count);
    }
    const current = daily.get(row.Date) ?? { protein: 0, calories: 0, proteinSeen: false, caloriesSeen: false, entries: 0 };
    const protein = number(row["Protein (g)"]);
    const calories = number(row.Calories);
    if (protein !== null) { current.protein += protein; current.proteinSeen = true; }
    if (calories !== null) { current.calories += calories; current.caloriesSeen = true; }
    current.entries++;
    daily.set(row.Date, current);
  }
  const nutritionLines = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) =>
    `- ${date}: ${d.proteinSeen ? `${d.protein} g protein logged` : "protein unreported"}; ` +
    `${d.caloriesSeen ? `${d.calories} kcal logged` : "calories unreported"}; ${d.entries} entries`,
  );
  const overlaps = [...itemCounts.values()].filter((entry) => entry.count > 1)
    .map((entry) => `${entry.date} ${entry.item} (${entry.count} entries)`);

  // Use at most one scale reading per day so repeat scans cannot dominate the mean.
  const bodyByDay = new Map<string, Row>();
  for (const row of csvObjects(files.body ?? "")) if (dayIndex(row.Date ?? "") !== null) bodyByDay.set(row.Date, row);
  const windows = [0, 1, 2].map((week) => {
    const rows = [...bodyByDay.values()].filter((row) => inWindow(row.Date, week * 7 + 6, week * 7));
    return {
      weight: rows.map((r) => number(r["Weight (lb)"])).filter((v): v is number => v !== null),
      muscle: rows.map((r) => number(r["Muscle Mass (lb)"])).filter((v): v is number => v !== null),
    };
  });
  const bodyLines = windows.map((w, i) =>
    `- ${i === 0 ? "Last 7" : i === 1 ? "Prior 7" : "14–20"} days: weight ${average(w.weight)}; scale muscle ${average(w.muscle)}`,
  );

  const sessions = new Map<string, string>();
  for (const row of csvObjects(files.workout ?? "")) {
    if (!inWindow(row.Date ?? "", 13, 0)) continue;
    const key = `${row.Date}|${row.Workout ?? "Session"}`;
    sessions.set(key, `${row.Date} ${row.Workout ?? "Session"}`);
  }
  const lastWeek = [...sessions.keys()].filter((key) => inWindow(key.slice(0, 10), 6, 0)).length;
  const priorWeek = [...sessions.keys()].filter((key) => inWindow(key.slice(0, 10), 13, 7)).length;
  const recentSessions = [...sessions.values()].sort().reverse().slice(0, 5);

  return `PROGRESS SNAPSHOT (through ${today}; computed from repo logs)
Nutrition, last 7 calendar days:${nutritionLines.length ? `\n${nutritionLines.join("\n")}` : " no entries"}
All nutrition totals are logged amounts only; a missing meal or metric makes a day incomplete. Never infer actual daily intake or a calorie deficit from these totals alone.
${overlaps.length ? `Possible overlapping food entries: ${overlaps.join("; ")}. Ask whether these were separate servings before using the totals for advice.` : ""}
Body trends (one reading per date; averages are not muscle-gain measurements):
${bodyLines.join("\n")}
Require at least 3 daily readings in each compared window before calling a weight or BIA muscle trend. Scale muscle is hydration-sensitive.
Training sessions: ${lastWeek} in the last 7 days vs ${priorWeek} in the prior 7 days. Recent: ${recentSessions.join("; ") || "none"}.
For strength progression, inspect the actual exercise rows, load, reps, RIR, and safety rules before recommending a change.`;
}
