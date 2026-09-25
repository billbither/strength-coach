import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgressSnapshot, csvObjects } from "./progress.js";

test("CSV parser keeps quoted commas, escaped quotes, and newlines in one row", () => {
  const rows = csvObjects('Date,Item,Notes\n2026-09-24,"""Lunch, large""","photo\nestimate"\n');
  assert.deepEqual(rows, [{ Date: "2026-09-24", Item: '"Lunch, large"', Notes: "photo\nestimate" }]);
});

test("snapshot counts logged nutrition, daily body readings, and distinct training sessions", () => {
  const snapshot = buildProgressSnapshot({
    nutrition: 'Date,Item,Protein (g),Calories,Notes\n2026-09-24,"Turkey, cheese",30,450,\n2026-09-24,Shake,25,,\n2026-09-21,Snack,,200,\n',
    body: 'Date,Weight (lb),Muscle Mass (lb)\n2026-09-24,180,145\n2026-09-24,181,146\n2026-09-22,179,144\n2026-09-20,178,143\n2026-09-15,177,142\n',
    workout: 'Date,Workout,Exercise\n2026-09-24,A,Bench\n2026-09-24,A,Row\n2026-09-21,B,Squat\n2026-09-15,C,Run\n',
  }, "2026-09-24");
  assert.match(snapshot, /2026-09-24: 55 g protein logged; 450 kcal logged; 2 entries/);
  assert.match(snapshot, /2026-09-21: protein unreported; 200 kcal logged; 1 entries/);
  assert.match(snapshot, /Last 7 days: weight 179\.3 lb \(3 days\); scale muscle 144\.3 lb \(3 days\)/);
  assert.match(snapshot, /Training sessions: 2 in the last 7 days vs 1 in the prior 7 days/);
  assert.match(snapshot, /missing meal or metric makes a day incomplete/);
});

test("snapshot flags possible duplicate food entries without silently dropping either", () => {
  const snapshot = buildProgressSnapshot({ nutrition:
    'Date,Item,Protein (g),Calories,Notes\n2026-09-24,Kombucha,0,50,\n2026-09-24,Kombucha (one bottle),0,80,\n' }, "2026-09-24");
  assert.match(snapshot, /130 kcal logged/);
  assert.match(snapshot, /Possible overlapping food entries: 2026-09-24 kombucha \(2 entries\)/);
});
