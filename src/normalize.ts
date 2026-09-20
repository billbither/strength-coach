// Exercise/movement names key the PR board, dashboard and weekly volume math, so a new row's
// name is snapped to the spelling already used in the log when they differ only by case,
// plural, whitespace or punctuation ("Pull-up" -> "Pull-ups", "KB Swing" -> "KB swings").

export function splitCsvRow(row: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of row) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "," && !inQuotes) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/s$/, "");
}

export function normalizeNameField(name: string, known: string[]): string {
  const trimmed = name.trim();
  if (known.includes(trimmed)) return trimmed;
  const k = key(trimmed);
  return known.find((n) => key(n) === k) ?? trimmed;
}

// Column index of the name field per log file; body.csv has none.
const NAME_COLUMN: Record<string, number> = { "workout-log.csv": 3, "snacks.csv": 1 };

export function normalizeRows(file: string, existingContent: string, rows: string[]): { rows: string[]; changes: string[] } {
  const col = NAME_COLUMN[file];
  if (col === undefined) return { rows, changes: [] };
  const known = [...new Set(existingContent.split("\n").slice(1).filter(Boolean).map((l) => splitCsvRow(l)[col]?.trim()).filter(Boolean))];
  const changes: string[] = [];
  const out = rows.map((row) => {
    const fields = splitCsvRow(row);
    if (fields.length <= col) return row;
    const fixed = normalizeNameField(fields[col], known);
    if (fixed === fields[col]) return row;
    changes.push(`"${fields[col]}" -> "${fixed}"`);
    fields[col] = fixed;
    return fields.join(",");
  });
  return { rows: out, changes };
}
