import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateFoodPhoto, imageMime } from "./food-photo.js";

test("recognizes supported image bytes instead of trusting a filename", () => {
  assert.equal(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(imageMime(Buffer.from("not an image")), null);
});

test("sends an image to DeepSeek Flash and parses a clarification request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.response_format.type, "json_object");
    assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.match(body.messages[1].content[0].text, /Caption: lunch/);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      isFood: true, cardVisible: false, item: "Chicken and rice", proteinG: null, calories: null,
      assumptions: "Portion size unclear", question: "How much chicken was there?",
    }) } }] }), { status: 200 });
  };
  try {
    const result = await estimateFoodPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "lunch");
    assert.equal(result.question, "How much chicken was there?");
    assert.equal(result.cardVisible, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
