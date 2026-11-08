import { Budget } from './internal.js';

// A binary64 value has an exact, finite decimal expansion. Round that expansion
// directly so printf precision is not limited by JavaScript's toFixed API.
export function formatFloat(number: number, code: string, flags: string, precision: number | undefined, budget: Budget): string {
  const sign = number < 0 || Object.is(number, -0) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  if (!Number.isFinite(number)) {
    const special = Number.isNaN(number) ? 'nan' : 'inf';
    return sign + (code === code.toUpperCase() ? special.toUpperCase() : special);
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(number));
  const bits = view.getBigUint64(0), exponentBits = Number((bits >> 52n) & 2047n);
  let coefficient = bits & ((1n << 52n) - 1n);
  if (exponentBits) coefficient |= 1n << 52n;
  const binaryExponent = exponentBits ? exponentBits - 1023 - 52 : -1074;
  const scale = binaryExponent < 0 ? -binaryExponent : 0;
  budget.buffered((scale + 64) * 4);
  budget.charge(scale + 64);
  const decimal = (binaryExponent < 0 ? coefficient * 5n ** BigInt(scale) : coefficient << BigInt(binaryExponent)).toString();
  const capacity = (length: number): void => {
    budget.outputCapacity(length + sign.length);
    budget.buffered((length + decimal.length + sign.length) * 6);
    budget.charge(length);
  };
  const round = (keep: number): string => {
    if (keep < 0) return '0';
    if (keep >= decimal.length) { capacity(keep); return decimal.padEnd(keep, '0'); }
    const head = decimal.slice(0, keep) || '0';
    const next = decimal[keep]!;
    let tailNonzero = false;
    for (let index = keep + 1; index < decimal.length; index++) if (decimal[index] !== '0') { tailNonzero = true; break; }
    const up = next > '5' || (next === '5' && (tailNonzero || Number(head.at(-1)) % 2 === 1));
    return up ? (BigInt(head) + 1n).toString() : head;
  };
  const digits = precision ?? 6, alternate = flags.includes('#');
  let result: string;
  if (code === 'f') {
    capacity(Math.max(1, decimal.length - scale) + digits + (digits || alternate ? 1 : 0));
    const rounded = round(decimal.length - scale + digits).padStart(digits + 1, '0');
    result = digits ? rounded.slice(0, -digits) + '.' + rounded.slice(-digits) : rounded + (alternate ? '.' : '');
  } else {
    const general = code === 'g' || code === 'G';
    const significant = general ? Math.max(1, digits) : digits + 1;
    let exponent = coefficient === 0n ? 0 : decimal.length - scale - 1;
    const keep = general && !alternate ? Math.min(significant, decimal.length) : significant;
    let rounded = coefficient === 0n ? '0' : round(keep);
    if (rounded.length > keep) { exponent++; rounded = rounded.slice(0, -1); }
    if (general && !alternate) {
      while (rounded.length > 1 && rounded.endsWith('0')) rounded = rounded.slice(0, -1);
    } else { capacity(significant + 8); rounded = rounded.padEnd(significant, '0'); }
    if (!general || exponent < -4 || exponent >= significant) {
      result = rounded[0]! + (rounded.length > 1 || alternate ? '.' + rounded.slice(1) : '') + (code === 'E' || code === 'G' ? 'E' : 'e') + (exponent < 0 ? '-' : '+') + Math.abs(exponent).toString().padStart(2, '0');
    } else {
      const point = exponent + 1;
      capacity(Math.max(rounded.length, point) + Math.max(0, 1 - point));
      result = point <= 0 ? '0.' + '0'.repeat(-point) + rounded : point < rounded.length ? rounded.slice(0, point) + '.' + rounded.slice(point) : rounded.padEnd(point, '0') + (alternate ? '.' : '');
    }
  }
  return sign + result;
}
