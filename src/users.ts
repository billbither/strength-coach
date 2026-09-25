export type UserConfig = {
  chatId: string;
  repo: string; // SQLite namespace; retains the legacy repo identifier for migrated users
  legacyRepo?: string;
  name: string;
};

// New users set key. Existing USERS entries with repo keep their namespace and enable one-time import.
export function loadUsers(): UserConfig[] {
  const raw = process.env.USERS;
  if (raw) {
    const parsed = JSON.parse(raw) as { chatId: string; repo?: string; key?: string; name: string }[];
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("USERS must be a non-empty JSON array");
    return parsed.map((u) => {
      if (!u.chatId || !(u.key || u.repo) || !u.name) throw new Error("USERS entry needs chatId, key (or legacy repo), and name");
      return { chatId: String(u.chatId), repo: u.key ?? u.repo!, legacyRepo: u.repo, name: u.name };
    });
  }
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const repo = process.env.STORAGE_KEY ?? process.env.GITHUB_REPO;
  if (!chatId || !repo) throw new Error("Set USERS, or TELEGRAM_CHAT_ID + STORAGE_KEY for single-user mode");
  return [{ chatId, repo, legacyRepo: process.env.STORAGE_KEY ? undefined : process.env.GITHUB_REPO, name: "you" }];
}
