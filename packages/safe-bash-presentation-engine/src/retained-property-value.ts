import { readJsonNumber } from '@poe-code/json-ast';
import type { ByteSource } from './contracts.js';
import { characters } from './retained-values.js';
import { decodePropertyValue } from './property-value.js';

/** Convert scalar metadata without collecting arbitrary padding, exponent or
 * fractional precision. Decimal rounding is shared with the backed JSON parser. */
export async function readRetainedPropertyValue(type: 'number' | 'boolean' | 'date', source: ByteSource, check: () => void): Promise<number | boolean | string | null> {
  if (type !== 'number') {
    let value = '', overflow = false, fraction = false, fractionDigits = 0;
    const limit = type === 'boolean' ? 5 : 128;
    for await (const character of characters(source)) {
      check();
      if (overflow) continue;
      if (type === 'date') {
        if (fraction && character >= '0' && character <= '9') { if (fractionDigits++ < 3) value += character; continue; }
        fraction = value.length === 19 && character === '.';
      }
      if (value.length >= limit) overflow = true; else value += character;
    }
    check(); return overflow ? null : decodePropertyValue(type, value);
  }
  let state: 'start' | 'sign' | 'integer' | 'dot' | 'fraction' | 'exponent' | 'exponent-sign' | 'exponent-digits' | 'radix' = 'start';
  let invalid = false, trailing = false, signed = false, firstZero = false, integerDigits = 0, radix = 0, radixDigits = 0, prefix = '', radixOverflow = false;
  async function* decimal() {
    for await (const character of characters(source)) {
      check(); if (invalid) continue;
      if (character.trim() === '') { if (state !== 'start') trailing = true; continue; }
      if (trailing) { invalid = true; continue; }
      const digit = character >= '0' && character <= '9';
      if (state === 'radix') {
        const code = character.toLowerCase().charCodeAt(0), value = digit ? code - 48 : code >= 97 && code <= 102 ? code - 87 : Infinity;
        if (value >= radix) { invalid = true; continue; }
        radixDigits++;
        if (prefix || value) { if (prefix.length < 1024) prefix += character; else radixOverflow = true; }
        continue;
      }
      if (state === 'start' || state === 'sign') {
        if (state === 'start' && (character === '+' || character === '-')) { signed = true; state = 'sign'; yield character; continue; }
        if (digit) { state = 'integer'; integerDigits = 1; firstZero = character === '0'; }
        else if (character === '.') state = 'dot'; else invalid = true;
      } else if (state === 'integer') {
        if (digit) integerDigits++;
        else if (!signed && firstZero && integerDigits === 1 && ['x', 'b', 'o'].includes(character.toLowerCase())) { radix = { x: 16, b: 2, o: 8 }[character.toLowerCase() as 'x' | 'b' | 'o']; state = 'radix'; continue; }
        else if (character === '.') state = 'fraction';
        else if (character === 'e' || character === 'E') state = 'exponent'; else invalid = true;
      } else if (state === 'dot') { if (digit) state = 'fraction'; else invalid = true; }
      else if (state === 'fraction') { if (character === 'e' || character === 'E') state = 'exponent'; else if (!digit) invalid = true; }
      else if (state === 'exponent' || state === 'exponent-sign') {
        if (digit) state = 'exponent-digits';
        else if (state === 'exponent' && (character === '+' || character === '-')) state = 'exponent-sign'; else invalid = true;
      } else if (!digit) invalid = true;
      if (!invalid) yield character;
    }
  }
  const value = await readJsonNumber(decimal(), async () => { check(); }, false); check();
  if (invalid || ['start', 'sign', 'dot', 'exponent', 'exponent-sign'].includes(state)) return null;
  if (radix) {
    if (!radixDigits || radixOverflow) return null;
    const result = Number(`0${radix === 16 ? 'x' : radix === 8 ? 'o' : 'b'}${prefix || '0'}`);
    return Number.isFinite(result) ? result : null;
  }
  return Number.isFinite(value) ? value : null;
}
