import { createTerminalStringFilter, terminalControlTailStart } from "./terminal-strings.js";

export const MAX_OUTPUT_PREVIEW_CHARS = 16_384;
export const OUTPUT_TRUNCATION_NOTICE = "[Output truncated: showing latest text]\n";

export function retainOutputTail(text: string, maxChars: number): string {
  let start = Math.max(0, text.length - maxChars);
  if (start > 0) {
    const newline = text.indexOf("\n", start);
    if (newline !== -1 && newline < text.length - 1) start = newline + 1;
    start = terminalControlTailStart(text, start);
    const firstCodeUnit = text.charCodeAt(start);
    if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) start += 1;
  }
  // Materialize the bounded tail rather than retaining a large substring backing store.
  return JSON.parse(JSON.stringify(text.slice(start))) as string;
}

export function limitOutputPreview(text: string): string {
  text = createTerminalStringFilter().push(text);
  if (text.length <= MAX_OUTPUT_PREVIEW_CHARS) return text;
  return (
    OUTPUT_TRUNCATION_NOTICE +
    retainOutputTail(text, MAX_OUTPUT_PREVIEW_CHARS - OUTPUT_TRUNCATION_NOTICE.length)
  );
}

/** Keep live deltas bounded without rebuilding the complete preview for every delta. */
export function createOutputPreviewBuffer(): { push(text: string): void; text(): string } {
  const strings = createTerminalStringFilter();
  const chunks: string[] = [];
  let chars = 0;
  let omitted = false;
  const tailBudget = MAX_OUTPUT_PREVIEW_CHARS - OUTPUT_TRUNCATION_NOTICE.length + 1;
  return {
    push(text) {
      text = strings.push(text);
      if (text.length === 0) return;
      if (text.length > MAX_OUTPUT_PREVIEW_CHARS) {
        chunks.length = 0;
        chars = 0;
        omitted = true;
        text = retainOutputTail(text, tailBudget);
      }
      chunks.push(text);
      chars += text.length;
      if (chars > MAX_OUTPUT_PREVIEW_CHARS) omitted = true;
      if (!omitted) return;
      while (chars > tailBudget) {
        const first = chunks[0]!;
        const excess = chars - tailBudget;
        if (first.length <= excess) {
          chars -= first.length;
          chunks.shift();
        } else {
          const start = terminalControlTailStart(first, excess);
          chunks[0] = first.slice(start);
          chars -= start;
        }
      }
    },
    text() {
      const text = chunks.join("");
      return limitOutputPreview((omitted ? OUTPUT_TRUNCATION_NOTICE : "") + text);
    }
  };
}
