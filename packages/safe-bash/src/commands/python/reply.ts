import { FsError } from '../../contracts/errors.js';

/** Own and admit a finite wire value before allocating its serialized payload. */
export function encodePythonReply(value: unknown, maxBytes: number): Uint8Array {
  let used = 0;
  const ancestors = new Set<object>();
  const reserve = (bytes: number): void => {
    used += bytes;
    if (used > maxBytes) throw new FsError('EFBIG', { syscall: 'python reply' });
  };
  const string = (text: string): string => {
    // Every UTF-16 code unit needs at least one output byte, even before quoting.
    if (text.length + 2 > maxBytes - used) throw new FsError('EFBIG', { syscall: 'python reply' });
    reserve(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code < 32) reserve([8, 9, 10, 12, 13].includes(code) ? 2 : 6);
      else if (code === 34 || code === 92) reserve(2);
      else if (code < 128) reserve(1);
      else if (code < 2048) reserve(2);
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { reserve(4); index++; }
      else reserve(code >= 0xd800 && code <= 0xdfff ? 6 : 3);
    }
    return text;
  };
  const own = (input: unknown, depth: number): unknown => {
    if (depth > 64) throw new FsError('EFBIG', { syscall: 'python reply' });
    if (input === null || input === undefined) { reserve(4); return null; }
    if (typeof input === 'string') return string(input);
    if (typeof input === 'number') { reserve(Number.isFinite(input) ? String(input).length : 4); return input; }
    if (typeof input === 'boolean') { reserve(input ? 4 : 5); return input; }
    if (typeof input !== 'object') throw new TypeError('Invalid Python reply value');
    if (ancestors.has(input)) throw new TypeError('Cyclic Python reply value');
    ancestors.add(input);
    try {
      if (input instanceof Uint8Array || Array.isArray(input)) {
        // Each slot contributes at least one value byte and one separator.
        if (input.length > maxBytes - used) throw new FsError('EFBIG', { syscall: 'python reply' });
        reserve(2);
        const output: unknown[] = [];
        for (let index = 0; index < input.length; index++) {
          if (index) reserve(1);
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (descriptor && !('value' in descriptor)) throw new TypeError('Accessor Python reply');
          output.push(own(descriptor?.value, depth + 1));
        }
        return output;
      }
      reserve(2);
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      let count = 0;
      let visited = 0;
      for (const key in input) {
        if (!Object.hasOwn(input, key)) continue;
        if (++visited > maxBytes) throw new FsError('EFBIG', { syscall: 'python reply' });
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!('value' in descriptor)) throw new TypeError('Accessor Python reply');
        if (descriptor.value === undefined || typeof descriptor.value === 'function') continue;
        if (count++) reserve(1);
        string(key); reserve(1);
        output[key] = own(descriptor.value, depth + 1);
      }
      return output;
    } finally { ancestors.delete(input); }
  };
  const owned = own(value, 0);
  return new TextEncoder().encode(JSON.stringify(owned));
}
