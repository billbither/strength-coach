const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// DeepSeek leaks markdown despite plain-text instructions (verified in prod 2026-07-08),
// and Telegram renders it literally — strip it before sending.
function stripMarkdown(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line)) // table separator rows |---|---|
    .filter((line) => !/^\s*[-*_]{3,}\s*$/.test(line)) // horizontal rules ---
    .map((line) =>
      line.includes("|")
        ? line.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "").replace(/\s*\|\s*/g, "   ")
        : line,
    )
    .join("\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "$1")
    .replace(/```[a-z]*\n?/g, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

export async function sendTelegram(chatId: string | number, text: string): Promise<void> {
  // Telegram caps messages at 4096 chars; split on paragraph boundaries when needed.
  const chunks: string[] = [];
  let rest = stripMarkdown(text);
  while (rest.length > 4096) {
    let cut = rest.lastIndexOf("\n", 4096);
    if (cut < 1000) cut = 4096;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);

  for (const chunk of chunks) {
    const res = await fetch(`${API()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
    if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
  }
}

export async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const metaRes = await fetch(`${API()}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const meta = (await metaRes.json()) as { ok: boolean; result?: { file_path: string } };
  if (!meta.ok || !meta.result) throw new Error(`Telegram getFile failed: ${JSON.stringify(meta)}`);
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${meta.result.file_path}`,
  );
  if (!fileRes.ok) throw new Error(`Telegram file download failed: ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

export async function setWebhook(url: string, secretToken: string): Promise<unknown> {
  const res = await fetch(`${API()}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message"] }),
  });
  return res.json();
}
