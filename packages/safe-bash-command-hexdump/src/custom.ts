import { formatFloat } from './float.js';
import { Budget, HexdumpError, raw } from './internal.js';

interface Conversion { code: string; flags: string; width: number; precision?: number; bytes: number }
type Part = string | Conversion;
interface Unit { repeat: number; bytes: number; explicitRepeat: boolean; parts: Part[] }
export interface CustomFormat { units: Unit[]; size: number; finalUnit?: Unit }

/** Parse the hexdump format grammar without evaluating format text as code. */
export function parseCustom(text: string, budget: Budget): CustomFormat {
  let at = 0;
  const fail = (): never => { throw new HexdumpError(`bad format: ${text}`); };
  const space = (): void => { while (at < text.length && ' \t\n\r'.includes(text[at]!)) at++; };
  const integer = (): number | undefined => {
    const start = at;
    while (at < text.length && '0123456789'.includes(text[at]!)) at++;
    if (start === at) return undefined;
    const value = Number(text.slice(start, at));
    if (!Number.isSafeInteger(value)) fail();
    return value;
  };
  const units: Unit[] = [];
  while (at < text.length) {
    space(); if (at === text.length) break;
    const repeat = integer(); space();
    let size: number | undefined;
    if (text[at] === '/') { at++; space(); size = integer() || undefined; space(); }
    if (text[at++] !== '"') fail();
    const parts: Part[] = [];
    let literal = '';
    while (at < text.length && text[at] !== '"') {
      budget.charge();
      let ch = text[at++]!;
      if (ch === '\\') {
        ch = text[at++] ?? fail();
        literal += ({ a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' } as Record<string, string>)[ch] ?? ch;
      } else if (ch !== '%') literal += ch;
      else if (text[at] === '%') { at++; literal += '%'; }
      else {
        if (literal) { parts.push(literal); literal = ''; }
        let flags = '';
        while (at < text.length && '#0- +'.includes(text[at]!)) flags += text[at++]!;
        const width = integer() ?? 0;
        let precision: number | undefined;
        if (text[at] === '.') { at++; precision = integer() ?? 0; }
        let code = text[at++] ?? fail();
        if (code === '_') { code += text[at++] ?? fail(); if (code === '_a' || code === '_A') code += text[at++] ?? fail(); }
        if (!['d', 'i', 'o', 'u', 'x', 'X', 'c', 's', 'e', 'E', 'f', 'g', 'G', '_c', '_p', '_u', '_ad', '_ao', '_ax', '_Ad', '_Ao', '_Ax'].includes(code)) fail();
        const bytes = code.startsWith('_a') || code.startsWith('_A') ? 0 : size ?? (code === 's' ? precision ?? fail() : ['c', '_c', '_p', '_u'].includes(code) ? 1 : 4);
        if (bytes < 0 || (code !== 's' && ![0, 1, 2, 4, 8].includes(bytes))) fail();
        if (['c', '_c', '_p', '_u'].includes(code) && bytes !== 1) fail();
        if (['e', 'E', 'f', 'g', 'G'].includes(code) && bytes !== 4 && bytes !== 8) fail();
        budget.check(width, budget.limits.maxBufferedBytes, 'format width');
        budget.check(precision ?? 0, budget.limits.maxBufferedBytes, 'format precision');
        parts.push({ code, flags, width, ...(precision === undefined ? {} : { precision }), bytes });
      }
    }
    if (text[at++] !== '"') fail();
    if (literal) parts.push(literal);
    const conversions = parts.filter((part): part is Conversion => typeof part !== 'string' && part.bytes > 0);
    if (size !== undefined && conversions.length > 1) fail();
    const bytes = size ?? conversions.reduce((total, part) => total + part.bytes, 0);
    budget.check(bytes * (repeat ?? 1), budget.limits.maxBufferedBytes, 'format block');
    units.push({ repeat: repeat ?? 1, explicitRepeat: repeat !== undefined, bytes, parts });
  }
  const size = units.reduce((total, unit) => total + unit.bytes * unit.repeat, 0);
  budget.check(size, budget.limits.maxBufferedBytes, 'format block');
  budget.retain(text.length * 2 + units.length * 64);
  const finalUnit = units.findLast(unit => unit.parts.some(part => typeof part !== 'string' && part.code.startsWith('_A')));
  return { units, size, ...(finalUnit ? { finalUnit } : {}) };
}

const controls = ['nul', 'soh', 'stx', 'etx', 'eot', 'enq', 'ack', 'bel', 'bs', 'ht', 'lf', 'vt', 'ff', 'cr', 'so', 'si', 'dle', 'dc1', 'dc2', 'dc3', 'dc4', 'nak', 'syn', 'etb', 'can', 'em', 'sub', 'esc', 'fs', 'gs', 'rs', 'us'];
function converted(part: Conversion, block: Uint8Array, offset: number, used: number, address: number, budget: Budget): string {
  const { code, flags, width, precision, bytes } = part;
  budget.buffered(Math.max(width, precision ?? 0) * 6);
  budget.outputCapacity(width);
  budget.charge(width);
  if (bytes && offset >= used) return ' '.repeat(width);
  let value = 0n;
  for (let i = code === 's' || ['e', 'E', 'f', 'g', 'G'].includes(code) ? -1 : bytes - 1; i >= 0; i--) value = value * 256n + BigInt(offset + i < used ? block[offset + i]! : 0);
  let text: string;
  if (code === 's') {
    let end = Math.min(used, offset + bytes, offset + (precision ?? bytes));
    for (let i = offset; i < end; i++) if (block[i] === 0) { end = i; break; }
    text = raw(block.subarray(offset, end));
  } else if (['c', '_p', '_c', '_u'].includes(code)) {
    const byte = Number(value);
    text = code === 'c' ? String.fromCharCode(byte) : code === '_p' ? byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.' : code === '_u' ? controls[byte] ?? (byte === 127 ? 'del' : byte > 127 ? byte.toString(16) : String.fromCharCode(byte)) : ({ 0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' } as Record<number, string>)[byte] ?? (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : byte.toString(8).padStart(3, '0'));
  } else if (['e', 'E', 'f', 'g', 'G'].includes(code)) {
    const copy = new Uint8Array(bytes); copy.set(block.subarray(offset, Math.min(used, offset + bytes)));
    const view = new DataView(copy.buffer), number = bytes === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
    text = formatFloat(number, code, flags, precision, budget);
    if (flags.includes('0') && !flags.includes('-') && Number.isFinite(number)) {
      const signed = text.startsWith('-') || text.startsWith('+') || text.startsWith(' ');
      budget.buffered(Math.max(width, text.length) * 6);
      budget.outputCapacity(Math.max(width, text.length));
      text = signed ? text[0]! + text.slice(1).padStart(Math.max(0, width - 1), '0') : text.padStart(width, '0');
    }
  } else {
    const addressCode = code.startsWith('_');
    if (addressCode) value = BigInt(address + offset);
    else if ((code === 'd' || code === 'i') && value >= 1n << BigInt(bytes * 8 - 1)) value -= 1n << BigInt(bytes * 8);
    const kind = code.at(-1)!;
    const radix = kind === 'x' || kind === 'X' ? 16 : kind === 'o' ? 8 : 10;
    const sign = value < 0n ? '-' : (code === 'd' || code === 'i' || code.endsWith('d')) && flags.includes('+') ? '+' : (code === 'd' || code === 'i' || code.endsWith('d')) && flags.includes(' ') ? ' ' : '';
    budget.outputCapacity(precision ?? 0);
    budget.charge(precision ?? 0);
    const digits = (value === 0n && precision === 0 ? '' : (value < 0n ? -value : value).toString(radix)).padStart(precision ?? 0, '0');
    const prefix = flags.includes('#') ? radix === 16 && value !== 0n ? '0x' : radix === 8 && !digits.startsWith('0') ? '0' : '' : '';
    text = sign + prefix + digits;
    if (flags.includes('0') && !flags.includes('-') && precision === undefined) text = sign + prefix + digits.padStart(Math.max(0, width - sign.length - prefix.length), '0');
    if (kind === 'X') text = text.toUpperCase();
  }
  return flags.includes('-') ? text.padEnd(width, ' ') : text.padStart(width, ' ');
}

export async function formatCustom(format: CustomFormat, block: Uint8Array, used: number, address: number, final: boolean, budget: Budget): Promise<string> {
  let offset = 0, result = '';
  const append = (text: string): void => {
    budget.buffered((result.length + text.length) * 6);
    budget.outputCapacity(result.length + text.length);
    budget.retain(text.length * 2);
    result += text;
  };
  try {
  for (const [index, unit] of format.units.entries()) {
    if (final && unit !== format.finalUnit) continue;
    const isFinal = unit.parts.some(part => typeof part !== 'string' && part.code.startsWith('_A'));
    if (isFinal !== final) { if (!final) offset += unit.bytes * unit.repeat; continue; }
    const repeat = !final && index === format.units.length - 1 && !unit.explicitRepeat && unit.bytes && format.size < block.length ? unit.repeat + Math.floor((block.length - format.size) / unit.bytes) : unit.repeat;
    for (let count = 0; count < repeat; count++) {
      budget.charge(unit.bytes + 1);
      const cp = budget.checkpointWork(); if (cp) await cp;
      let position = offset;
      for (let i = 0; i < unit.parts.length; i++) {
        const part = unit.parts[i]!;
        if (typeof part === 'string') {
          let end = part.length;
          if (count === repeat - 1 && repeat > 1 && i === unit.parts.length - 1) while (end && ' \t'.includes(part[end - 1]!)) end--;
          append(part.slice(0, end));
        } else { append(converted(part, block, position, used, address, budget)); position += part.bytes; }
      }
      offset += unit.bytes;
    }
  }
  return result;
  } finally { budget.retain(-result.length * 2); }
}
