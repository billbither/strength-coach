import { sendTelegram } from "./telegram.js";
import type { UserConfig } from "./users.js";
import { checkStorage } from "./storage.js";

// Probe storage and model dependencies directly instead of inferring health from job outcomes.

export type HealthProblem = { severity: "broken" | "warning"; message: string };

async function checkDatabase(users: UserConfig[]): Promise<HealthProblem[]> {
  const problems: HealthProblem[] = [];
  for (const u of users) {
    try {
      checkStorage(u.repo);
    } catch (e) {
      problems.push({ severity: "broken", message: `SQLite unavailable for ${u.name}: ${String(e).slice(0, 150)}` });
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
  const problems = [...(await checkDatabase(users)), ...(await checkModel())];
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
