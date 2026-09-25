import { test } from "node:test";
import assert from "node:assert/strict";
import { nutritionRow } from "./nutrition.js";

test("nutrition entries preserve missing values and escape CSV text", () => {
  assert.equal(nutritionRow({ date: "2026-09-24", item: 'Chicken, "large"', proteinG: 42, notes: "estimated, cooked" }),
    '2026-09-24,"Chicken, ""large""",42,,"estimated, cooked"');
  assert.equal(nutritionRow({ date: "2026-09-24", item: "Lunch", calories: 650 }),
    "2026-09-24,Lunch,,650,");
});

test("nutrition entries reject dates and amounts that would corrupt totals", () => {
  assert.throws(() => nutritionRow({ date: "2026-02-30", item: "Lunch", calories: 500 }), /valid ISO date/);
  assert.throws(() => nutritionRow({ date: "2026-09-24", item: "Lunch", calories: -2 }), /nonnegative/);
  assert.throws(() => nutritionRow({ date: "2026-09-24", item: "Lunch" }), /Provide protein/);
  assert.throws(() => nutritionRow({ date: "2026-09-24", item: "Lunch\nDinner", proteinG: 20 }), /one line/);
});
