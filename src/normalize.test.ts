import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNameField, normalizeRows, splitCsvRow } from "./normalize.js";

test("splitCsvRow respects quoted commas", () => {
  assert.deepEqual(splitCsvRow('2026-09-19,Sat,Builder A,Pull-ups,4 x 7,Bodyweight,RIR 1,"strict, no kip"'), [
    "2026-09-19", "Sat", "Builder A", "Pull-ups", "4 x 7", "Bodyweight", "RIR 1", '"strict, no kip"',
  ]);
});

test("snaps plural/case/punctuation variants to the existing spelling", () => {
  const known = ["Pull-ups", "KB swings", "Barbell Deadlift"];
  assert.equal(normalizeNameField("Pull-up", known), "Pull-ups");
  assert.equal(normalizeNameField("pullups", known), "Pull-ups");
  assert.equal(normalizeNameField("KB Swing", known), "KB swings");
  assert.equal(normalizeNameField("kb swings ", known), "KB swings");
});

test("leaves genuinely new names alone", () => {
  assert.equal(normalizeNameField("Nordic Curl", ["Pull-ups"]), "Nordic Curl");
  assert.equal(normalizeNameField("Deadlift", ["Barbell Deadlift"]), "Deadlift");
});

test("prefers an exact match over a fuzzy one", () => {
  assert.equal(normalizeNameField("Dips", ["Ring Dips", "Dips"]), "Dips");
});

test("normalizeRows rewrites only the name column and reports changes", () => {
  const log = 'Date,Day,Workout,Exercise,Sets x Reps,Weight,RIR/Effort,Notes\n2026-09-05,Sat,Builder A,Pull-ups,3 x 10,Bodyweight,RIR 1,"ok, strict"\n';
  const { rows, changes } = normalizeRows("workout-log.csv", log, [
    '2026-09-19,Sat,Builder A,pull-up,4 x 7,Bodyweight + 5 lb,RIR 1,"strict, no kip"',
    "2026-09-19,Sat,Builder A,Nordic Curl,2 x 5,Bodyweight,RIR 2,",
  ]);
  assert.deepEqual(rows, [
    '2026-09-19,Sat,Builder A,Pull-ups,4 x 7,Bodyweight + 5 lb,RIR 1,"strict, no kip"',
    "2026-09-19,Sat,Builder A,Nordic Curl,2 x 5,Bodyweight,RIR 2,",
  ]);
  assert.deepEqual(changes, ['"pull-up" -> "Pull-ups"']);
});

test("normalizeRows ignores files without a name column", () => {
  const { rows, changes } = normalizeRows("body.csv", "Date,Weight (lb)\n", ["2026-09-19,178"]);
  assert.deepEqual(rows, ["2026-09-19,178"]);
  assert.deepEqual(changes, []);
});
