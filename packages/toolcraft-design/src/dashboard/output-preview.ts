export const MAX_OUTPUT_PREVIEW_CHARS = 16_384;
export const OUTPUT_TRUNCATION_NOTICE = "[Output truncated: showing latest text]\n";

export function retainOutputTail(text: string, maxChars: number): string {
  let start = Math.max(0, text.length - maxChars);
  if (start > 0) {
    const newline = text.indexOf("\n", start);
    if (newline !== -1 && newline < text.length - 1) start = newline + 1;
    const firstCodeUnit = text.charCodeAt(start);
    if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) start += 1;
  }
  // Materialize the bounded tail rather than retaining a large substring backing store.
  return JSON.parse(JSON.stringify(text.slice(start))) as string;
}

export function limitOutputPreview(text: string): string {
  if (text.length <= MAX_OUTPUT_PREVIEW_CHARS) return text;
  return (
    OUTPUT_TRUNCATION_NOTICE +
    retainOutputTail(text, MAX_OUTPUT_PREVIEW_CHARS - OUTPUT_TRUNCATION_NOTICE.length)
  );
}
