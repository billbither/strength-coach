import { sendTelegram } from "./telegram.js";
import type { UserConfig } from "./users.js";

// Credential failures are the silent killer: the agent catches a 401 from a tool,
// replies "I couldn't read your files", and the job looks successful. So probe the
// dependencies DIRECTLY rather than inferring health from job outcomes.

const EXPIRY_WARN_DAYS = 7;

export type HealthProblem = { severity: "broken" | "warning"; message: string };

async function checkGitHub(users: UserConfig[]): Promise<HealthProblem[]> {
  const problems: HealthProblem[] = [];
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "strength-coach-agent",
  };

  for (const u of users) {
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${u.repo}`, { headers });
    } catch (e) {
      problems.push({ severity: "broken", message: `GitHub unreachable for ${u.repo}: ${String(e).slice(0, 120)}` });
      continue;
    }
    if (res.status === 401) {
      problems.push({
        severity: "broken",
        message: `GitHub token rejected (401 Bad credentials). The coach cannot read or write ${u.repo}. Regenerate the token at github.com/settings/personal-access-tokens and update the GITHUB_TOKEN secret.`,
      });
      return problems; // one bad token breaks every repo; don't repeat it per user
    }
    if (!res.ok) {
      problems.push({ severity: "broken", message: `GitHub ${res.status} on ${u.repo} — check token repo access.` });
      continue;
    }
    // Fine-grained PATs report their own expiry on every response.
    const exp = res.headers.get("github-authentication-token-expiration");
    if (exp) {
      const when = new Date(exp.replace(" UTC", "Z").replace(" ", "T"));
      const days = Math.floor((when.getTime() - Date.now()) / 86_400_000);
      if (!Number.isNaN(days) && days <= EXPIRY_WARN_DAYS) {
        problems.push({
          severity: days <= 0 ? "broken" : "warning",
          message:
            days <= 0
              ? `GitHub token EXPIRED (${exp}). Regenerate it now.`
              : `GitHub token expires in ${days} day${days === 1 ? "" : "s"} (${exp}). Regenerate it at github.com/settings/personal-access-tokens before it dies, then update the GITHUB_TOKEN secret.`,
        });
      }
    }
  }
  return problems;
}

async function checkModel(): Promise<HealthProblem[]> {
  // Raw call so this probes exactly what breaks in practice: API key valid, model
  // name still accepted (DeepSeek retired its aliases once already), balance positive.
  const model = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ok" }], max_tokens: 1 }),
    });
    if (res.ok) return [];
    const body = (await res.text()).slice(0, 200);
    const hint =
      res.status === 402
        ? " Add credit at platform.deepseek.com."
        : res.status === 400 && body.includes("model")
          ? " Model name may have been retired — see src/models.ts (DEEPSEEK_CHAT_MODEL / DEEPSEEK_REASONER_MODEL can override without a deploy)."
          : "";
    return [{ severity: "broken", message: `DeepSeek API ${res.status}: ${body}${hint}` }];
  } catch (e) {
    return [{ severity: "broken", message: `DeepSeek unreachable: ${String(e).slice(0, 150)}` }];
  }
}

export async function runHealthCheck(users: UserConfig[], adminChatId: string, context: string): Promise<HealthProblem[]> {
  const problems = [...(await checkGitHub(users)), ...(await checkModel())];
  if (problems.length === 0) {
    console.log(`health check (${context}): all dependencies OK`);
    return problems;
  }
  for (const p of problems) console.error(`health check (${context}) [${p.severity}]: ${p.message}`);
  const broken = problems.filter((p) => p.severity === "broken");
  const header = broken.length ? "🚨 Coach is DEGRADED" : "⚠️ Coach heads-up";
  await sendTelegram(adminChatId, `${header} (${context})\n\n${problems.map((p) => `- ${p.message}`).join("\n\n")}`).catch(
    (e) => console.error("failed to send health alert:", e),
  );
  return problems;
}
