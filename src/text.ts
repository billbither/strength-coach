// Mastra's result.text concatenates text from ALL steps, which includes pre-tool-call
// narration like "Let me check your log...". Only the last step's text is the real answer.
export function finalText(result: { text?: string; steps?: { text?: string }[] }, fallback = "(no reply)"): string {
  const last = result.steps?.length ? result.steps[result.steps.length - 1]?.text : undefined;
  return (last ?? result.text ?? "").trim() || fallback;
}
