/** The longest supported pdftk page-label style name is 22 code units. */
export async function parsePdftkStyleChunks(chunks: AsyncIterable<string>, signal: AbortSignal): Promise<string> {
  let value = "", oversized = false;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    if (oversized) continue;
    if (value.length + chunk.length > "UppercaseRomanNumerals".length) { value = ""; oversized = true; }
    else value += chunk;
  }
  return value;
}
