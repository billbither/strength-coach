import { deepseek } from "@ai-sdk/deepseek";

// DeepSeek model names (they deprecate aliases periodically — 2026-07-25 the old
// deepseek-chat / deepseek-reasoner aliases were removed). Override via env if needed.
const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-pro";

export const chatModel = () => deepseek(CHAT_MODEL);
export const reasonerModel = () => deepseek(REASONER_MODEL);
