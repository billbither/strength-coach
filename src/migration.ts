import type { UserConfig } from "./users.js";
import { hasMigrated, importLegacyFiles, migrationStats } from "./storage.js";

type GitHubEntry = { type: "file" | "dir"; path: string };

function url(repo: string, path = ""): string {
  return `https://api.github.com/repos/${repo}/contents${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`;
}

function headers(accept: string): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required for the one-time GitHub to SQLite migration");
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "strength-coach-agent-migration",
  };
}

async function listFiles(repo: string, path = ""): Promise<string[]> {
  const response = await fetch(url(repo, path), { headers: headers("application/vnd.github+json") });
  if (!response.ok) throw new Error(`GitHub migration list ${repo}/${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  const entries = await response.json() as GitHubEntry[];
  if (!Array.isArray(entries)) throw new Error(`GitHub migration expected a directory at ${repo}/${path}`);
  const nested = await Promise.all(entries.map(async (entry) =>
    entry.type === "dir" ? listFiles(repo, entry.path) : entry.type === "file" ? [entry.path] : []));
  return nested.flat().sort();
}

async function downloadFile(repo: string, path: string): Promise<Buffer> {
  const response = await fetch(url(repo, path), { headers: headers("application/vnd.github.raw+json") });
  if (!response.ok) throw new Error(`GitHub migration read ${repo}/${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function ensureMigrated(users: UserConfig[]): Promise<void> {
  for (const user of users) {
    if (hasMigrated(user.repo)) {
      const stats = migrationStats(user.repo)!;
      console.log(`SQLite ready for ${user.name}: imported ${stats.fileCount} files, ${stats.byteCount} bytes`);
      continue;
    }
    const paths = user.legacyRepo ? await listFiles(user.legacyRepo) : [];
    const files = await Promise.all(paths.map(async (path) => ({ path, content: await downloadFile(user.legacyRepo!, path) })));
    importLegacyFiles(user.repo, files);
    console.log(`SQLite migration complete for ${user.name}: ${files.length} files, ${files.reduce((n, file) => n + file.content.length, 0)} bytes`);
  }
}
