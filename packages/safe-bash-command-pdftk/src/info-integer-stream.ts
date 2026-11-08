/** Decimal parseInt semantics with at most 309 significant digits retained.
 * Larger decimal integers overflow IEEE-754 regardless of their suffix. */
export async function parsePdftkIntegerChunks(chunks: AsyncIterable<string>, signal: AbortSignal): Promise<number> {
  let leading = true, negative = false, digits = "", seen = false, work = 0;
  const value = () => seen ? (negative ? -1 : 1) * Number.parseInt(digits || "0", 10) : NaN;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    for (const character of chunk) {
      if (++work % 4096 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
      if (leading) {
        if (!character.trim()) continue;
        leading = false;
        if (character === "-" || character === "+") { negative = character === "-"; continue; }
      }
      if (character < "0" || character > "9") return value();
      seen = true;
      if (!digits.length && character === "0") continue;
      if (digits.length === 309) return negative ? -Infinity : Infinity;
      digits += character;
    }
  }
  signal.throwIfAborted(); return value();
}
