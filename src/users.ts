export type UserConfig = {
  chatId: string;
  repo: string;
  name: string;
};

// USERS is a JSON array: [{"chatId":"123","repo":"owner/data-repo","name":"Bill"}, ...]
// Falls back to the original single-user env vars so existing deployments keep working.
export function loadUsers(): UserConfig[] {
  const raw = process.env.USERS;
  if (raw) {
    const parsed = JSON.parse(raw) as UserConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("USERS must be a non-empty JSON array");
    for (const u of parsed) {
      if (!u.chatId || !u.repo || !u.name) throw new Error(`USERS entry missing chatId/repo/name: ${JSON.stringify(u)}`);
    }
    return parsed;
  }
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const repo = process.env.GITHUB_REPO;
  if (!chatId || !repo) throw new Error("Set USERS, or TELEGRAM_CHAT_ID + GITHUB_REPO for single-user mode");
  return [{ chatId, repo, name: "you" }];
}
