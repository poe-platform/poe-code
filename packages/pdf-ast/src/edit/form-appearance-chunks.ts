export interface FormAppearanceOptions {
  readonly width: number;
  readonly height: number;
  readonly fontSize?: number;
  readonly colorOp?: string;
  readonly alignment?: number;
  readonly maxLength?: number;
  readonly comb?: boolean;
  readonly password?: boolean;
  readonly signal?: AbortSignal;
}

/** Serialize form text operators in owned chunks of at most 16 KiB. The input
 * string is borrowed; no array of lines, code points, or complete output is built.
 * Consumers control backpressure by requesting the next chunk. */
export function* serializeFormAppearanceChunks(text: string, options: FormAppearanceOptions): Generator<Uint8Array, void, void> {
  options.signal?.throwIfAborted();
  const encoder = new TextEncoder(); let buffer = new Uint8Array(16384), used = 0;
  for (const part of operators(text, options)) {
    let offset = 0;
    while (offset < part.length) {
      options.signal?.throwIfAborted();
      // Bound temporary substrings too, including caller-supplied color operators.
      let end = Math.min(part.length, offset + 4096);
      if (end < part.length && part.charCodeAt(end - 1) >= 0xd800 && part.charCodeAt(end - 1) <= 0xdbff) end--;
      const result = encoder.encodeInto(part.slice(offset, end), buffer.subarray(used));
      used += result.written; offset += result.read;
      if (used === buffer.length || result.read === 0) {
        yield used === buffer.length ? buffer : buffer.slice(0, used);
        options.signal?.throwIfAborted(); buffer = new Uint8Array(16384); used = 0;
      }
    }
  }
  if (used) { yield buffer.slice(0, used); options.signal?.throwIfAborted(); }
}

function* literal(text: string, start: number, end: number, password: boolean): Generator<string> {
  let part = "";
  for (let i = start; i < end; i++) {
    const ch = password ? "*" : text[i]!;
    if (ch === "(" || ch === ")" || ch === "\\") part += "\\";
    part += ch;
    // Keep surrogate pairs together so UTF-8 encoding matches a single encode.
    if (!password && text.charCodeAt(i) >= 0xd800 && text.charCodeAt(i) <= 0xdbff && i + 1 < end && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) part += text[++i]!;
    if (part.length >= 4096) { yield part; part = ""; }
  }
  if (part) yield part;
}

function* operators(text: string, options: FormAppearanceOptions): Generator<string> {
  const password = options.password ?? false;
  const firstNewline = password ? -1 : text.indexOf("\n");
  const startY = firstNewline >= 0 ? Math.max(4, options.height - 13) : 4;
  yield "/Tx BMC q BT ";
  if (options.colorOp) { yield options.colorOp; yield " "; }
  yield `/F1 ${options.fontSize ?? 11} Tf `;
  if (options.comb && options.maxLength && options.maxLength > 0 && firstNewline < 0) {
    const cell = options.width / options.maxLength;
    for (let at = 0, index = 0; at < text.length && index < Math.floor(options.maxLength); index++) {
      const code = password ? 42 : text.codePointAt(at)!;
      const end = at + (code > 0xffff ? 2 : 1);
      if (index) yield " ";
      yield `1 0 0 1 ${Number((index * cell + Math.max(1, (cell - 6) / 2)).toFixed(2))} ${Math.round(startY)} Tm (`;
      yield* literal(text, at, end, password); yield ") Tj"; at = end;
    }
  } else {
    let start = 0, previousX = 0, first = true, newline = firstNewline;
    while (true) {
      let end = newline < 0 ? text.length : newline;
      if (newline >= 0 && end > start && text[end - 1] === "\r") end--;
      const width = (end - start) * 6;
      const x = options.alignment === 1 ? Math.max(2, Math.round((options.width - width) / 2)) : options.alignment === 2 ? Math.max(2, Math.round(options.width - width - 2)) : 2;
      if (!first) yield " ";
      yield `${first ? x : x - previousX} ${first ? Math.round(startY) : -13} Td (`;
      yield* literal(text, start, end, password); yield ") Tj";
      if (newline < 0) break;
      previousX = x; first = false; start = newline + 1; newline = text.indexOf("\n", start);
    }
  }
  yield " ET Q EMC\n";
}
