const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function sendTelegram(chatId: string | number, text: string): Promise<void> {
  // Telegram caps messages at 4096 chars; split on paragraph boundaries when needed.
  const chunks: string[] = [];
  let rest = text;
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

export async function setWebhook(url: string, secretToken: string): Promise<unknown> {
  const res = await fetch(`${API()}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message"] }),
  });
  return res.json();
}
