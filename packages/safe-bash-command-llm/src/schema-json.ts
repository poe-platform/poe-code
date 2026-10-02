// Keep object insertion order and Python's integer/float distinction. Ordinary
// JSON.parse loses both before the display formatter has a chance to use them.
type Value = string | boolean | null | {number: string} | Value[] | Map<string, Value>;

function parse(text: string, signal: AbortSignal): Value {
  let offset = 0;
  const fail = (): never => { throw new SyntaxError('Invalid schema JSON'); };
  const space = (): void => { while (' \n\r\t'.includes(text[offset] ?? '\0')) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') offset++;
      else if (char === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    return fail();
  };
  const value = (): Value => {
    signal.throwIfAborted(); space();
    const char = text[offset];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      offset++; space();
      const object = char === '{', end = object ? '}' : ']';
      const entries = new Map<string, Value>(), array: Value[] = [];
      if (text[offset] !== end) while (true) {
        if (object) {
          if (text[offset] !== '"') return fail();
          const key = string(); space();
          if (text[offset++] !== ':') return fail();
          entries.set(key, value());
        } else array.push(value());
        space();
        if (text[offset] === end) break;
        if (text[offset++] !== ',') return fail();
        space();
      }
      offset++;
      return object ? entries : array;
    }
    for (const [token, result] of [['null', null], ['true', true], ['false', false]] as const) {
      if (text.startsWith(token, offset)) { offset += token.length; return result; }
    }
    for (const token of ['NaN', 'Infinity', '-Infinity']) {
      if (text.startsWith(token, offset)) { offset += token.length; return {number: token}; }
    }
    const start = offset;
    while (offset < text.length && '-+0123456789.eE'.includes(text[offset]!)) offset++;
    const token = text.slice(start, offset);
    if (!token || typeof JSON.parse(token) !== 'number') return fail();
    return {number: token};
  };
  const result = value(); space();
  if (offset !== text.length) fail();
  return result;
}

function numberText(raw: string): string {
  if (raw === 'NaN' || raw.includes('Infinity')) return raw;
  if (!raw.includes('.') && !raw.includes('e') && !raw.includes('E')) return BigInt(raw).toString();
  const value = Number(raw);
  if (!Number.isFinite(value)) return value < 0 ? '-Infinity' : 'Infinity';
  if (Object.is(value, -0)) return '-0.0';
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 0.0001 || absolute >= 1e16)) {
    const [mantissa, exponent] = value.toExponential().split('e') as [string, string];
    const sign = exponent.startsWith('-') ? '-' : '+';
    const digits = exponent.slice(1).padStart(2, '0');
    return mantissa + 'e' + sign + digits;
  }
  const result = String(value);
  return result.includes('.') ? result : result + '.0';
}

/** Render admitted stored JSON with Python json.dumps(indent=2) semantics.
 * Output is chunked; the selected schema remains a budgeted control value. */
export async function renderSchemaJson(text: string, emit: (text: string) => Promise<void>, signal: AbortSignal): Promise<void> {
  const root = parse(text, signal);
  let output = '';
  const append = async (text: string): Promise<void> => {
    signal.throwIfAborted();
    for (let offset = 0; offset < text.length; offset += 8192) {
      output += text.slice(offset, offset + 8192);
      if (output.length >= 8192) { await emit(output); output = ''; signal.throwIfAborted(); }
    }
  };
  const string = async (text: string): Promise<void> => {
    await append('"');
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index), char = text[index]!;
      output += code >= 127 ? '\\u' + code.toString(16).padStart(4, '0') :
        code < 32 || char === '"' || char === '\\' ? JSON.stringify(char).slice(1, -1) : char;
      if (output.length >= 8192) { await emit(output); output = ''; signal.throwIfAborted(); }
    }
    await append('"');
  };
  const render = async (value: Value, depth: number): Promise<void> => {
    if (typeof value === 'string') { await string(value); return; }
    if (value === null || typeof value === 'boolean') { await append(String(value)); return; }
    if (!(value instanceof Map) && !Array.isArray(value)) { await append(numberText(value.number)); return; }
    const object = value instanceof Map;
    await append(object ? '{' : '[');
    let count = 0;
    for (const [key, child] of value.entries()) {
      await append((count++ ? ',\n' : '\n') + '  '.repeat(depth + 1));
      if (object) { await string(String(key)); await append(': '); }
      await render(child, depth + 1);
    }
    if (count) await append('\n' + '  '.repeat(depth));
    await append(object ? '}' : ']');
  };
  await render(root, 0); await append('\n');
  if (output) await emit(output);
}
