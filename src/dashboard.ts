import { marked } from "marked";
import { readRepoFile } from "./github.js";
import type { UserConfig } from "./users.js";

// ---------- data parsing ----------

function parseCsv(content: string): { header: string[]; rows: string[][] } {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const [head, ...rest] = lines;
  return { header: parseLine(head), rows: rest.map(parseLine) };
}

type Row = Record<string, string>;
function asObjects(csv: { header: string[]; rows: string[][] }): Row[] {
  return csv.rows.map((r) => Object.fromEntries(csv.header.map((h, i) => [h, r[i] ?? ""])));
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// "50 lb x2" -> 50, "135 lb" -> 135, "Bodyweight" -> null
const parseLoad = (w: string): number | null => (/bodyweight|^-|^$/i.test(w.trim()) ? null : num(w));
// "4 x 8" -> 8, "3 x 10/side" -> 10, "1 x 5 mi" -> null (not reps)
const parseReps = (sr: string): number | null => {
  const m = sr.match(/x\s*(\d+)(?!\s*(mi|min|km|sec))/i);
  return m ? Number(m[1]) : null;
};
const parseSets = (sr: string): number | null => {
  const m = sr.match(/^(\d+)\s*x/i);
  return m ? Number(m[1]) : null;
};

// ---------- svg helpers ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Pt = { x: string; y: number };
type Series = { name: string; color: string; pts: Pt[] };

function lineChart(series: Series[], opts: { unit?: string; height?: number } = {}): string {
  const H = opts.height ?? 180;
  const W = 560;
  const padL = 44;
  const padR = 96;
  const padT = 14;
  const padB = 26;
  const all = series.flatMap((s) => s.pts.map((p) => p.y));
  if (!all.length) return `<p class="muted">No data yet.</p>`;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.12;
  hi += span * 0.12;
  const labels = [...new Set(series.flatMap((s) => s.pts.map((p) => p.x)))].sort();
  const xi = (x: string) => labels.indexOf(x);
  const X = (x: string) => padL + (labels.length === 1 ? 0.5 : xi(x) / (labels.length - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const grid = [0.25, 0.5, 0.75]
    .map((f) => {
      const v = lo + f * (hi - lo);
      return `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${padL - 6}" y="${Y(v) + 3}" class="axis" text-anchor="end">${v >= 100 ? v.toFixed(0) : v.toFixed(1)}</text>`;
    })
    .join("");
  const xTicks = [labels[0], labels[labels.length - 1]]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map(
      (l) =>
        `<text x="${X(l)}" y="${H - 8}" class="axis" text-anchor="${xi(l) === 0 ? "start" : "end"}">${esc(l.slice(5))}</text>`,
    )
    .join("");
  const marks = series
    .map((s) => {
      const sorted = [...s.pts].sort((a, b) => a.x.localeCompare(b.x));
      const path = sorted.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
      const dots = sorted
        .map(
          (p) =>
            `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="5" fill="${s.color}" class="dot" data-tip="${esc(s.name)} · ${esc(p.x)} · ${p.y}${opts.unit ?? ""}"/>`,
        )
        .join("");
      const last = sorted[sorted.length - 1];
      const label = `<text x="${(X(last.x) + 10).toFixed(1)}" y="${(Y(last.y) + 4).toFixed(1)}" class="dl"><tspan fill="${s.color}">●</tspan> ${esc(s.name)} ${last.y}${opts.unit ?? ""}</text>`;
      return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2"/>${dots}${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${xTicks}${marks}</svg>`;
}

function barChart(items: { label: string; value: number; tip?: string }[], color: string, unit = ""): string {
  if (!items.length) return `<p class="muted">No data yet.</p>`;
  const W = 560;
  const rowH = 30;
  const padL = 118;
  const padR = 76;
  const H = items.length * rowH + 8;
  const max = Math.max(...items.map((i) => i.value), 1);
  const bars = items
    .map((it, i) => {
      const y = 6 + i * rowH;
      const w = Math.max(((W - padL - padR) * it.value) / max, 2);
      return (
        `<text x="${padL - 8}" y="${y + 15}" class="axis" text-anchor="end">${esc(it.label)}</text>` +
        `<rect x="${padL}" y="${y}" width="${w.toFixed(1)}" height="20" rx="3" fill="${color}" class="dot" data-tip="${esc(it.tip ?? `${it.label}: ${it.value}${unit}`)}"/>` +
        `<text x="${padL + w + 8}" y="${y + 15}" class="dl">${it.value}${unit}</text>`
      );
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${bars}</svg>`;
}

// ---------- page assembly ----------

async function tryRead(repo: string, file: string): Promise<string> {
  try {
    return (await readRepoFile(repo, file)).content;
  } catch {
    return "";
  }
}

export async function renderDashboard(user: UserConfig, weeksBack = 0): Promise<string> {
  const [bodyCsv, logCsv, snacksCsv, records, plan] = await Promise.all([
    tryRead(user.repo, "body.csv"),
    tryRead(user.repo, "workout-log.csv"),
    tryRead(user.repo, "snacks.csv"),
    tryRead(user.repo, "records.md"),
    tryRead(user.repo, "coach-plan.md"),
  ]);

  const body = bodyCsv ? asObjects(parseCsv(bodyCsv)) : [];
  const log = logCsv ? asObjects(parseCsv(logCsv)) : [];
  const snacks = snacksCsv ? asObjects(parseCsv(snacksCsv)) : [];

  // stat tiles
  const latest = body[body.length - 1];
  const tiles = latest
    ? [
        ["Weight", `${latest["Weight (lb)"]} lb`],
        ["Body fat", `${latest["Body Fat %"]}%`],
        ["Muscle mass", `${latest["Muscle Mass (lb)"]} lb`],
        ["Body age", latest["Body Age"] ? `${latest["Body Age"]} yr` : "—"],
      ]
        .map(([k, v]) => `<div class="tile"><div class="tile-v">${esc(v)}</div><div class="tile-k">${esc(k)}</div></div>`)
        .join("")
    : `<p class="muted">No weigh-ins logged yet.</p>`;

  // body comp series
  const S1 = "var(--s1)";
  const S2 = "var(--s2)";
  const wm = lineChart(
    [
      { name: "Weight", color: S1, pts: body.flatMap((r) => (num(r["Weight (lb)"]) ? [{ x: r.Date, y: num(r["Weight (lb)"])! }] : [])) },
      { name: "Muscle", color: S2, pts: body.flatMap((r) => (num(r["Muscle Mass (lb)"]) ? [{ x: r.Date, y: num(r["Muscle Mass (lb)"])! }] : [])) },
    ],
    { unit: " lb" },
  );
  const bf = lineChart(
    [{ name: "Body fat", color: S1, pts: body.flatMap((r) => (num(r["Body Fat %"]) ? [{ x: r.Date, y: num(r["Body Fat %"])! }] : [])) }],
    { unit: "%", height: 150 },
  );

  // segmental muscle (latest)
  const segCols: [string, string][] = [
    ["Arm L", "Muscle Arm L (lb)"],
    ["Arm R", "Muscle Arm R (lb)"],
    ["Trunk", "Muscle Trunk (lb)"],
    ["Leg L", "Muscle Leg L (lb)"],
    ["Leg R", "Muscle Leg R (lb)"],
  ];
  const segItems = latest
    ? segCols.flatMap(([label, col]) => {
        const v = num(latest[col]);
        return v ? [{ label, value: v }] : [];
      })
    : [];
  const seg = barChart(segItems, S1, " lb");

  // lift e1RM trends: top exercises by frequency with parseable load+reps
  const byEx = new Map<string, Pt[]>();
  for (const r of log) {
    const load = parseLoad(r.Weight ?? "");
    const reps = parseReps(r["Sets x Reps"] ?? "");
    if (load == null || reps == null) continue;
    const e1 = Math.round(load * (1 + reps / 30));
    const arr = byEx.get(r.Exercise) ?? [];
    arr.push({ x: r.Date, y: e1 });
    byEx.set(r.Exercise, arr);
  }
  const liftCharts = [...byEx.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(
      ([name, pts]) =>
        `<div class="card"><h3>${esc(name)} — est. 1RM</h3>${lineChart([{ name: "e1RM", color: S1, pts }], { unit: " lb", height: 140 })}</div>`,
    )
    .join("");

  // selected week (Mon-Sun, America/New_York), weeksBack weeks before the current one
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = (today.getDay() + 6) % 7; // Mon=0
  const monday = new Date(today);
  monday.setDate(today.getDate() - dow - weeksBack * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const wkStart = iso(monday);
  const wkEnd = iso(sunday);
  const inWeek = (d: string) => d >= wkStart && d <= wkEnd;
  const movements: [string, RegExp][] = [
    ["Pull-ups", /pull.?up/i],
    ["Push-ups", /push.?up/i],
    ["KB Swings", /swing/i],
  ];
  const volume = movements.map(([label, rx]) => {
    let total = 0;
    for (const s of snacks) if (inWeek(s.Date) && rx.test(s.Movement ?? "") && /rep/i.test(s.Unit ?? "")) total += num(s.Amount) ?? 0;
    for (const r of log) {
      if (!inWeek(r.Date) || !rx.test(r.Exercise ?? "")) continue;
      const sets = parseSets(r["Sets x Reps"] ?? "");
      const reps = parseReps(r["Sets x Reps"] ?? "");
      if (sets && reps) total += sets * reps;
    }
    return { label, value: total, tip: `${label} ${wkStart} to ${wkEnd}: ${total} reps` };
  });
  const vol = barChart(volume, S2, "");

  // sessions in the selected week
  const recent = log
    .filter((r) => inWeek(r.Date))
    .reverse()
    .map(
      (r) =>
        `<tr><td>${esc(r.Date)}</td><td>${esc(r.Workout)}</td><td>${esc(r.Exercise)}</td><td>${esc(r["Sets x Reps"])}</td><td>${esc(r.Weight)}</td><td>${esc(r["RIR/Effort"] ?? "")}</td></tr>`,
    )
    .join("");

  const planHtml = plan ? await marked.parse(plan) : '<p class="muted">No plan yet.</p>';
  const recordsHtml = records ? await marked.parse(records) : '<p class="muted">No records yet.</p>';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(user.name)} — Training Dashboard</title>
<style>
:root{--surface:#fcfcfb;--text:#0b0b0b;--text2:#52514e;--muted:#8a887f;--line:#e4e2da;--s1:#2a78d6;--s2:#1baf7a;--card:#ffffff}
@media (prefers-color-scheme: dark){:root{--surface:#1a1a19;--text:#ffffff;--text2:#c3c2b7;--muted:#8a887f;--line:#3a3936;--s1:#3987e5;--s2:#199e70;--card:#232322}}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;padding:20px}
.wrap{max-width:1180px;margin:0 auto}h1{font-size:22px;margin:0 0 2px}h2{font-size:16px;margin:26px 0 10px}h3{font-size:13.5px;margin:0 0 6px;color:var(--text2);font-weight:600}
.sub{color:var(--text2);font-size:13px;margin-bottom:18px}
.tiles{display:flex;gap:12px;flex-wrap:wrap}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 18px;min-width:130px}
.tile-v{font-size:24px;font-weight:700}.tile-k{font-size:12px;color:var(--text2)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
svg{width:100%;height:auto;display:block}
svg .grid{stroke:var(--line);stroke-width:1}svg .axis{fill:var(--muted);font-size:10.5px}svg .dl{fill:var(--text2);font-size:11px}
.dot{cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--text2);font-weight:600;border-bottom:1px solid var(--line);padding:6px 8px}
td{border-bottom:1px solid var(--line);padding:6px 8px}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;white-space:pre-wrap;font-size:12.5px;line-height:1.45;overflow-x:auto}
.muted{color:var(--muted)}
.weeknav{font-size:13px;margin:-4px 0 10px}.weeknav a{color:var(--s1);text-decoration:none}.weeknav a:hover{text-decoration:underline}
.md h1{font-size:17px;margin:4px 0 10px}.md h2{font-size:15px;margin:18px 0 8px}.md h3{font-size:13.5px;margin:14px 0 6px;color:var(--text2)}
.md p,.md li{font-size:13.5px;color:var(--text)}.md ul{padding-left:20px;margin:6px 0}.md table{margin:8px 0}.md hr{border:none;border-top:1px solid var(--line);margin:14px 0}
.md strong{font-weight:600}.md code{background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:12.5px}#tip{position:fixed;display:none;background:var(--text);color:var(--surface);font-size:12px;padding:4px 9px;border-radius:6px;pointer-events:none;z-index:9}
</style></head><body><div class="wrap">
<h1>${esc(user.name)} — Training Dashboard</h1>
<div class="sub">Live from ${esc(user.repo)} · generated ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET</div>
<div class="tiles">${tiles}</div>
<h2>Body composition</h2>
<div class="grid2">
  <div class="card"><h3>Weight &amp; muscle mass (lb)</h3>${wm}</div>
  <div class="card"><h3>Body fat (%)</h3>${bf}</div>
  <div class="card"><h3>Segmental muscle — latest (lb)</h3>${seg}</div>
  <div class="card"><h3>Weekly volume — week of ${wkStart} (reps)</h3>${vol}</div>
</div>
<h2>Lifts</h2>
<div class="grid2">${liftCharts || '<p class="muted">Not enough logged lifts yet.</p>'}</div>
<h2>Sessions — week of ${wkStart}${weeksBack === 0 ? " (current)" : ""}</h2>
<div class="weeknav"><a href="?w=${weeksBack + 1}">← previous week</a>${weeksBack > 0 ? ` · <a href="?w=${weeksBack - 1}">next week →</a> · <a href="?w=0">current</a>` : ""}</div>
<div class="card" style="overflow-x:auto">${recent ? `<table><thead><tr><th>Date</th><th>Workout</th><th>Exercise</th><th>Sets×Reps</th><th>Weight</th><th>Effort</th></tr></thead><tbody>${recent}</tbody></table>` : '<p class="muted">No sessions logged this week.</p>'}</div>
<h2>PR board</h2>
<div class="card md" style="overflow-x:auto">${recordsHtml}</div>
<h2>Current plan</h2>
<div class="card md" style="overflow-x:auto">${planHtml}</div>
</div>
<div id="tip"></div>
<script>
const tip=document.getElementById('tip');
document.addEventListener('mousemove',e=>{const t=e.target.closest('[data-tip]');if(t){tip.textContent=t.dataset.tip;tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px'}else tip.style.display='none'});
</script>
</body></html>`;
}
