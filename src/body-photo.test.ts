import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyPhotoRow, classifyBodyPhoto, compareBodyPhotos, latestPhoto, listBodyPhotos, saveBodyPhoto, type BodyPhotoRecord } from "./body-photo.js";
import { readRepoBinaryFile, readRepoFile, writeRepoFile } from "./storage.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

test("indexes a photo with CSV-safe notes and finds the latest matching view", () => {
  const front: BodyPhotoRecord = {
    date: "2026-09-24", view: "front", path: "body-photos/2026-09-24-a.jpg",
    comparison: 'Shoulders look more defined, perhaps', notes: 'Front, "even" lighting\nindoors',
  };
  assert.equal(bodyPhotoRow(front), '2026-09-24,front,body-photos/2026-09-24-a.jpg,"Shoulders look more defined, perhaps","Front, ""even"" lighting indoors"');
  const older = { ...front, date: "2026-08-24", path: "body-photos/older.jpg" };
  assert.equal(latestPhoto([older, { ...front, view: "side" }, front], "front"), front);
  assert.equal(latestPhoto([front], "back"), undefined);
});

test("classifies a progress photo and compares two images in chronological order", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.thinking.type, "disabled");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.messages[1].content.length, calls === 0 ? 2 : 3);
    assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    const answer = calls++ === 0
      ? { bodyVisible: true, view: "front", qualityNote: "clear view" }
      : { comparable: true, changes: ["Shoulder outline looks a little clearer"], limitations: "lighting differs" };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }] }), { status: 200 });
  };
  try {
    assert.equal((await classifyBodyPhoto(jpeg, "body photo")).view, "front");
    assert.deepEqual((await compareBodyPhotos(jpeg, Buffer.from([0xff, 0xd8, 0xff, 0x01]), "front")).changes,
      ["Shoulder outline looks a little clearer"]);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("saves a photo and its index atomically in SQLite", async () => {
  const owner = "body-photo-test";
  const path = await saveBodyPhoto(owner, "2026-09-25", jpeg, "front", "Baseline", "clear view");
  assert.deepEqual(await readRepoBinaryFile(owner, path), jpeg);
  const records = await listBodyPhotos(owner);
  assert.equal(records.length, 1);
  assert.equal(records[0].path, path);
  const second = await saveBodyPhoto(owner, "2026-10-25", jpeg, "front", "Clearer outline", "same pose");
  assert.equal(latestPhoto(await listBodyPhotos(owner), "front")?.path, second);
});

test("rolls back the photo when the index header is invalid", async () => {
  const owner = "body-photo-invalid-index";
  await writeRepoFile(owner, "body-photos.csv", "wrong,header\n", undefined, "test");
  await assert.rejects(saveBodyPhoto(owner, "2026-09-25", jpeg, "front", "Baseline", ""), /unexpected header/);
  assert.equal((await readRepoFile(owner, "body-photos.csv")).content, "wrong,header\n");
});
