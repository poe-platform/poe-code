import type { SofficeBudget } from './budget.js';
import { SofficeError } from './contracts.js';
/** Export only. Import token meanings require their own contract. */
export interface CsvExportOptions {
  readonly complete: boolean;
  readonly fieldSeparator: string;
  readonly textSeparator: string;
  readonly encoding: string;
  readonly fixedWidth: boolean;
  readonly quoteAllText: boolean;
  readonly saveNumberAsSuch: boolean;
  readonly saveAsShown: boolean;
  readonly saveFormulas: boolean;
  readonly removeSpace: boolean;
  readonly sheet: number;
  readonly evaluateFormulas: boolean;
  readonly bom: boolean;
  readonly endianness: 'big' | 'little';
}
function digits(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) if (char < '0' || char > '9') return false;
  return true;
}
function separator(value: string): string {
  if (!digits(value)) throw new SofficeError('unsupported', 'unsupported CSV separator', value);
  const point = Number(value);
  if (!Number.isSafeInteger(point) || point > 65535 || (point >= 0xd800 && point <= 0xdfff)) throw new SofficeError('invalid-argument', 'invalid CSV separator');
  return point === 0 ? '' : String.fromCharCode(point);
}
export function parseCsvExportOptions(options: string | undefined, budget: SofficeBudget): CsvExportOptions {
  // A pure options contract, deliberately no evaluation or sheet export.
  budget.checkpoint();
  if (options !== undefined) budget.chargeText(options);
  const defaults: CsvExportOptions = { complete: true, fieldSeparator: ',', textSeparator: '"', encoding: 'UTF8', fixedWidth: false, quoteAllText: false, saveNumberAsSuch: true, saveAsShown: options !== undefined, saveFormulas: false, removeSpace: false, sheet: 0, evaluateFormulas: true, bom: false, endianness: 'little' };
  if (options === undefined) return defaults;
  let tokenCount = 1;
  for (const char of options) {
    budget.charge('work', 1);
    if (char === ',') tokenCount++;
  }
  // Reserve token slots, substring/case-conversion storage and result objects
  // before split. Successful reservations live until invocation close because
  // the returned encoding retains token text.
  const reservation = 4 * options.length + 32 * tokenCount + 128;
  budget.charge('retainedBytes', reservation);
  try {
    const tokens = options.split(',');
    if (tokens.length < 3) return { ...defaults, complete: false, fieldSeparator: '', textSeparator: '', encoding: 'unknown' };
    const basic = { ...defaults, fixedWidth: tokens[0]!.toUpperCase() === 'FIX', fieldSeparator: tokens[0]!.toUpperCase() === 'FIX' ? '' : separator(tokens[0]!), textSeparator: separator(tokens[1]!), encoding: tokens[2]! };
    if (tokens.length === 4 && !digits(tokens[3]!.startsWith('-') ? tokens[3]!.slice(1) : tokens[3]!)) throw new SofficeError('invalid-argument', 'legacy CSV boolean must be numeric');
    if (tokens.length === 4) return { ...basic, saveAsShown: Number(tokens[3]) !== 0, quoteAllText: true };
    if (tokens[14] !== undefined && tokens[14] !== '0' && tokens[14] !== '1') throw new SofficeError('unsupported', 'unsupported CSV endianness', tokens[14]);
    const sheet = tokens[11] ?? '';
    const index = sheet === '-1' ? -1 : sheet === '' ? 0 : digits(sheet) && Number.isSafeInteger(Number(sheet)) ? Number(sheet) : -23;
    return { ...basic, quoteAllText: tokens[6] === 'true', saveNumberAsSuch: tokens[7] === undefined ? true : tokens[7] === 'true', saveAsShown: tokens[8] === undefined ? true : tokens[8] === 'true', saveFormulas: tokens[9] === 'true', removeSpace: tokens[10] === 'true', sheet: index, evaluateFormulas: tokens[12] === undefined || tokens[12] === 'true', bom: tokens[13] === 'true', endianness: tokens[14] === '0' ? 'big' : 'little' };
  } catch (error) {
    budget.releaseRetainedBytes(reservation);
    throw error;
  }
}
