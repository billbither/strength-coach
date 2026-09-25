import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const databasePath = process.env.SQLITE_PATH === ":memory:" ? ":memory:" : resolve(process.env.SQLITE_PATH ?? "data/coach.sqlite");
if (process.env.FLY_APP_NAME && databasePath.startsWith("/data/")) {
  const mounted = readFileSync("/proc/mounts", "utf8").split("\n").some((line) => line.split(" ")[1] === "/data");
  if (!mounted) throw new Error("SQLite volume is not mounted at /data; refusing to start with ephemeral storage");
}
if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath, { timeout: 5000 });
db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS files (
  owner TEXT NOT NULL,
  path TEXT NOT NULL,
  content BLOB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner, path)
);
CREATE TABLE IF NOT EXISTS migrated_owners (
  owner TEXT PRIMARY KEY,
  file_count INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS file_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  note TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

type StoredFile = { content: Uint8Array; version: number };

function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function get(owner: string, path: string): StoredFile | undefined {
  return db.prepare("SELECT content, version FROM files WHERE owner = ? AND path = ?").get(owner, path) as StoredFile | undefined;
}

function event(owner: string, path: string, version: number, note: string): void {
  db.prepare("INSERT INTO file_events (owner, path, version, note) VALUES (?, ?, ?, ?)").run(owner, path, version, note);
}

export function hasMigrated(owner: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM migrated_owners WHERE owner = ?").get(owner));
}

export function importLegacyFiles(owner: string, files: { path: string; content: Buffer }[]): void {
  transaction(() => {
    if (hasMigrated(owner)) return;
    const insert = db.prepare("INSERT INTO files (owner, path, content) VALUES (?, ?, ?)");
    let bytes = 0;
    for (const file of files) {
      if (get(owner, file.path)) throw new Error(`SQLite migration found existing ${owner}/${file.path}`);
      insert.run(owner, file.path, file.content);
      const stored = get(owner, file.path);
      if (!stored || !Buffer.from(stored.content).equals(file.content)) {
        throw new Error(`SQLite migration verification failed for ${owner}/${file.path}`);
      }
      bytes += file.content.length;
    }
    db.prepare("INSERT INTO migrated_owners (owner, file_count, byte_count) VALUES (?, ?, ?)").run(owner, files.length, bytes);
  });
}

export function migrationStats(owner: string): { fileCount: number; byteCount: number } | undefined {
  const row = db.prepare("SELECT file_count, byte_count FROM migrated_owners WHERE owner = ?").get(owner) as
    | { file_count: number; byte_count: number } | undefined;
  return row ? { fileCount: row.file_count, byteCount: row.byte_count } : undefined;
}

export function checkStorage(owner: string): void {
  if (!hasMigrated(owner)) throw new Error(`SQLite migration incomplete for ${owner}`);
  const result = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
  if (result.quick_check !== "ok") throw new Error(`SQLite integrity check failed: ${result.quick_check}`);
}

export async function readRepoBinaryFile(owner: string, path: string): Promise<Buffer> {
  const file = get(owner, path);
  if (!file) throw new Error(`SQLite read ${owner}/${path} failed: 404 not found`);
  return Buffer.from(file.content);
}

export async function writeRepoBinaryFile(owner: string, path: string, content: Buffer, message: string): Promise<void> {
  transaction(() => {
    if (get(owner, path)) throw new Error(`SQLite write ${owner}/${path} failed: 422 already exists`);
    db.prepare("INSERT INTO files (owner, path, content) VALUES (?, ?, ?)").run(owner, path, content);
    event(owner, path, 1, message);
  });
}

export async function readRepoFile(owner: string, path: string): Promise<{ content: string; sha: string }> {
  const file = get(owner, path);
  if (!file) throw new Error(`SQLite read ${owner}/${path} failed: 404 not found`);
  return { content: Buffer.from(file.content).toString("utf8"), sha: String(file.version) };
}

export async function writeRepoFile(owner: string, path: string, content: string, sha: string | undefined, message: string): Promise<void> {
  transaction(() => {
    const file = get(owner, path);
    if (file && sha === undefined) throw new Error(`SQLite write ${owner}/${path} failed: 422 already exists`);
    if (!file && sha !== undefined) throw new Error(`SQLite write ${owner}/${path} failed: 404 not found`);
    if (file && String(file.version) !== sha) throw new Error(`SQLite write ${owner}/${path} failed: 409 stale version`);
    if (file) {
      db.prepare("UPDATE files SET content = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner = ? AND path = ?")
        .run(Buffer.from(content, "utf8"), owner, path);
      event(owner, path, file.version + 1, message);
    } else {
      db.prepare("INSERT INTO files (owner, path, content) VALUES (?, ?, ?)").run(owner, path, Buffer.from(content, "utf8"));
      event(owner, path, 1, message);
    }
  });
}

export async function appendRepoFile(owner: string, path: string, lines: string[], message: string): Promise<void> {
  transaction(() => {
    const file = get(owner, path);
    if (!file) throw new Error(`SQLite read ${owner}/${path} failed: 404 not found`);
    const current = Buffer.from(file.content).toString("utf8");
    const base = current.endsWith("\n") || !current ? current : `${current}\n`;
    db.prepare("UPDATE files SET content = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner = ? AND path = ?")
      .run(Buffer.from(`${base}${lines.join("\n")}\n`, "utf8"), owner, path);
    event(owner, path, file.version + 1, message);
  });
}

export function saveBodyPhotoRecord(owner: string, path: string, image: Buffer, row: string, header: string): void {
  transaction(() => {
    if (get(owner, path)) throw new Error(`SQLite write ${owner}/${path} failed: 422 already exists`);
    db.prepare("INSERT INTO files (owner, path, content) VALUES (?, ?, ?)").run(owner, path, image);
    event(owner, path, 1, "body photo uploaded");
    const index = get(owner, "body-photos.csv");
    const current = index ? Buffer.from(index.content).toString("utf8") : `${header}\n`;
    if (current.split("\n")[0] !== header) throw new Error("body-photos.csv has an unexpected header");
    const base = current.endsWith("\n") ? current : `${current}\n`;
    if (index) {
      db.prepare("UPDATE files SET content = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner = ? AND path = 'body-photos.csv'")
        .run(Buffer.from(`${base}${row}\n`, "utf8"), owner);
      event(owner, "body-photos.csv", index.version + 1, "body photo indexed");
    } else {
      db.prepare("INSERT INTO files (owner, path, content) VALUES (?, 'body-photos.csv', ?)")
        .run(owner, Buffer.from(`${base}${row}\n`, "utf8"));
      event(owner, "body-photos.csv", 1, "body photo indexed");
    }
  });
}

export { databasePath };

export async function backupDatabase(target: string): Promise<void> {
  await backup(db, target);
}
