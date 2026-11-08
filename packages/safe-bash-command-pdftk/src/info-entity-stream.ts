/** Decode pdftk's permissive numeric entities from repeatable bounded chunks.
 * Failed candidates replay their retained input instead of buffering the body. */
export async function* decodePdftkEntityChunks(read: (start: number) => AsyncIterable<string>, signal: AbortSignal): AsyncGenerator<string, void, void> {
  let input = read(0)[Symbol.asyncIterator](), buffer = "", offset = 0, position = 0, ended = false, work = 0, failed = false;
  async function ready() {
    signal.throwIfAborted();
    while (offset === buffer.length && !ended) {
      if (++work % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
      const next = await input.next(); ended = !!next.done; buffer = next.value ?? ""; offset = 0;
    }
  }
  async function until(delimiter: string) {
    await ready(); if (ended) return undefined;
    const found = buffer.indexOf(delimiter, offset), end = found < 0 ? buffer.length : found;
    const text = buffer.slice(offset, end); position += end - offset; offset = end; return text;
  }
  async function next() { await ready(); if (ended) return undefined; position++; return buffer[offset++]; }
  async function seek(target: number) {
    await input.return?.(undefined); input = read(target)[Symbol.asyncIterator](); buffer = ""; offset = 0; position = target; ended = false;
  }
  try {
    while (true) {
      const literal = await until("&"); if (literal === undefined) break;
      if (literal) { yield literal; continue; }
      const start = position; await next();
      if (await next() !== "#") { yield "&"; await seek(start + 1); continue; }
      let first = true, radix = 10, phase: "space" | "first" | "zero" | "digits" = "space", sign = "", digits = "", hasDigit = false, stopped = false, overflow = false, terminated = false;
      function consume(character: string) {
        if (first) { first = false; if (character === "x" || character === "X") { radix = 16; return; } }
        if (stopped) return;
        if (phase === "space") {
          if (!character.trim()) return;
          phase = "first"; if (character === "+" || character === "-") { sign = character; return; }
        }
        if (phase === "first") {
          if (radix === 16 && character === "0") { phase = "zero"; hasDigit = true; return; }
          phase = "digits";
        } else if (phase === "zero") {
          phase = "digits"; if (character === "x" || character === "X") { hasDigit = false; return; }
        }
        const value = Number.parseInt(character, radix);
        if (!Number.isFinite(value)) { stopped = true; return; }
        hasDigit = true;
        if (digits || value) { if (digits.length < 310) digits += character; else overflow = true; }
      }
      while (true) {
        const body = await until(";"); if (body === undefined) break;
        if (!body) { await next(); terminated = true; break; }
        for (const character of body) consume(character);
      }
      if (!terminated) {
        await seek(start);
        while (true) { await ready(); if (ended) break; const rest = buffer.slice(offset); position += rest.length; offset = buffer.length; yield rest; }
        break;
      }
      const number = !hasDigit ? NaN : overflow ? Infinity : Number.parseInt(sign + (digits || "0"), radix);
      if (Number.isFinite(number) && number >= 0) yield String.fromCodePoint(number);
      else { yield "&"; await seek(start + 1); }
    }
  } catch (error) { failed = true; throw error; }
  finally { await Promise.resolve().then(() => input.return?.(undefined)).catch(error => { if (!failed) throw error; }); }
}
