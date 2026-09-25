import { test } from "node:test";
import assert from "node:assert/strict";
import { cardTip, estimateFoodPhoto, foodQuestion, imageMime, type FoodEstimate } from "./food-photo.js";

test("recognizes supported image bytes instead of trusting a filename", () => {
  assert.equal(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(imageMime(Buffer.from("not an image")), null);
});

test("sends an image to DeepSeek Flash and parses a clarification request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.thinking.type, "disabled");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.max_tokens, 2048);
    assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.match(body.messages[1].content[0].text, /Caption: lunch/);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      isFood: true, isLabel: false, cardVisible: false, needsPortionScale: true,
      item: "Chicken and rice", proteinG: null, calories: null,
      assumptions: "Portion size unclear", question: "How much chicken was there?",
    }) } }] }), { status: 200 });
  };
  try {
    const result = await estimateFoodPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "lunch");
    assert.equal(result.question, "How much chicken was there?");
    assert.equal(result.cardVisible, false);
    assert.match(cardTip(result), /credit card/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries a truncated vision response with a larger output budget", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, calls === 1 ? 2048 : 4096);
    return new Response(JSON.stringify({ choices: [{
      finish_reason: calls === 1 ? "length" : "stop",
      message: { content: calls === 1 ? "" : JSON.stringify({
        isFood: true, isLabel: false, cardVisible: true, needsPortionScale: false,
        item: "Sandwich", proteinG: 30, calories: 500,
        assumptions: "standard serving", question: null,
      }) },
    }] }), { status: 200 });
  };
  try {
    const result = await estimateFoodPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    assert.equal(calls, 2);
    assert.equal(result.calories, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("card is suggested only when physical portion size is uncertain, never for labels", () => {
  const base: FoodEstimate = {
    isFood: true, isLabel: false, cardVisible: false, needsPortionScale: false,
    item: "Dinner", proteinG: 30, calories: 500, assumptions: "", question: null,
  };
  assert.equal(cardTip(base), "");
  assert.match(cardTip({ ...base, needsPortionScale: true }), /credit card/);
  assert.equal(cardTip({ ...base, needsPortionScale: true, cardVisible: true }), "");
  assert.equal(cardTip({ ...base, isLabel: true, needsPortionScale: true }), "");
  assert.equal(foodQuestion({ ...base, isLabel: true, question: "Can you add a credit card?" }),
    "How many servings did you eat or drink?");
});
