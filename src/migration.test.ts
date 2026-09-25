import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureMigrated } from "./migration.js";
import { hasMigrated, readRepoBinaryFile, readRepoFile } from "./storage.js";

test("imports each legacy user's files and photos, then starts without GitHub", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "migration-test-token";
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0x42]);
  const routes = new Map<string, unknown>([
    ["owner/one/contents", [{ type: "file", path: "coach-rules.md" }, { type: "dir", path: "body-photos" }]],
    ["owner/one/contents/body-photos", [{ type: "file", path: "body-photos/one.jpg" }]],
    ["owner/two/contents", [{ type: "file", path: "nutrition.csv" }]],
    ["owner/one/contents/coach-rules.md", Buffer.from("# Rules\n")],
    ["owner/one/contents/body-photos/one.jpg", photo],
    ["owner/two/contents/nutrition.csv", Buffer.from("Date,Item\n")],
  ]);
  globalThis.fetch = async (url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer migration-test-token");
    const path = String(url).replace("https://api.github.com/repos/", "");
    const value = routes.get(path);
    assert.notEqual(value, undefined, path);
    return Array.isArray(value) ? Response.json(value) : new Response(Uint8Array.from(value as Buffer));
  };
  const users = [
    { chatId: "1", repo: "owner/one", legacyRepo: "owner/one", name: "One" },
    { chatId: "2", repo: "owner/two", legacyRepo: "owner/two", name: "Two" },
  ];
  try {
    await ensureMigrated(users);
    assert.equal((await readRepoFile("owner/one", "coach-rules.md")).content, "# Rules\n");
    assert.deepEqual(await readRepoBinaryFile("owner/one", "body-photos/one.jpg"), photo);
    assert.equal((await readRepoFile("owner/two", "nutrition.csv")).content, "Date,Item\n");
    globalThis.fetch = async () => { throw new Error("GitHub should not be called again"); };
    delete process.env.GITHUB_TOKEN;
    await ensureMigrated(users);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
});

test("refuses to mark an inaccessible legacy repo as migrated", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "migration-test-token";
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  try {
    await assert.rejects(ensureMigrated([{ chatId: "3", repo: "private/missing", legacyRepo: "private/missing", name: "Missing" }]), /failed: 404/);
    assert.equal(hasMigrated("private/missing"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }
});
