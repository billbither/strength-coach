import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appendRepoFile, backupDatabase, importLegacyFiles, migrationStats, readRepoBinaryFile, readRepoFile, writeRepoFile } from "./storage.js";

test("imports separate users with byte-perfect files and images", async () => {
  const image = Buffer.from([0, 255, 16, 42]);
  importLegacyFiles("first", [{ path: "body.csv", content: Buffer.from("Date,Weight\n") }, { path: "body-photos/one.jpg", content: image }]);
  importLegacyFiles("second", [{ path: "body.csv", content: Buffer.from("Date,Weight\n2026-09-25,150\n") }]);
  assert.deepEqual(await readRepoBinaryFile("first", "body-photos/one.jpg"), image);
  assert.equal((await readRepoFile("second", "body.csv")).content, "Date,Weight\n2026-09-25,150\n");
  assert.equal((await readRepoFile("first", "body.csv")).content, "Date,Weight\n");
  assert.deepEqual(migrationStats("first"), { fileCount: 2, byteCount: image.length + Buffer.byteLength("Date,Weight\n") });
});

test("appends rows without stale full-file writes and rejects stale edits", async () => {
  const owner = "append-test";
  await writeRepoFile(owner, "nutrition.csv", "Date,Item\n", undefined, "create");
  const before = await readRepoFile(owner, "nutrition.csv");
  await Promise.all([
    appendRepoFile(owner, "nutrition.csv", ["2026-09-25,Lunch"], "first"),
    appendRepoFile(owner, "nutrition.csv", ["2026-09-25,Dinner"], "second"),
  ]);
  const after = (await readRepoFile(owner, "nutrition.csv")).content;
  assert.match(after, /Lunch/);
  assert.match(after, /Dinner/);
  await assert.rejects(writeRepoFile(owner, "nutrition.csv", "stale", before.sha, "edit"), /409 stale version/);
});

test("online backup includes committed files", async () => {
  const owner = "backup-test";
  await writeRepoFile(owner, "coach-rules.md", "# Rules\n", undefined, "create");
  const path = join(tmpdir(), `coach-backup-${randomUUID()}.sqlite`);
  try {
    await backupDatabase(path);
    const copy = new DatabaseSync(path);
    try {
      const row = copy.prepare("SELECT content FROM files WHERE owner = ? AND path = ?").get(owner, "coach-rules.md") as { content: Uint8Array };
      assert.equal(Buffer.from(row.content).toString("utf8"), "# Rules\n");
    } finally { copy.close(); }
  } finally { await unlink(path).catch(() => {}); }
});
