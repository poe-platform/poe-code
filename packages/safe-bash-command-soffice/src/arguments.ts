import { SofficeError, type SofficeInvocation, type ConversionParameters, type FileEvent } from './contracts.js';
import type { SofficeBudget } from './budget.js';
function descriptor(value: string): { name: string; options: string } {
  const colon = value.indexOf(':');
  return colon < 0 ? { name: value, options: '' } : { name: value.slice(0, colon), options: value.slice(colon + 1) };
}
/** Explicit Unicode SDK text policy. CLI must admit byte argv with fatal UTF-8 decoding first. */
export function parseSofficeArguments(args: readonly string[], budget: SofficeBudget): SofficeInvocation {
  budget.checkpoint();
  // Count UTF-8 bytes without allocating an unbounded encoded argument copy.
  for (const arg of args) {
    budget.charge('work', 1);
    budget.chargeText(arg);
  }
  return parseEvents(args, budget);
}

/** Fatal UTF-8 byte admission. A leading BOM is a literal pathname character.
 * Decoded text reservations belong to the invocation until budget.close().
 * The caller owns the byte buffers and must not mutate them during this call.
 */
export function parseSofficeByteArguments(args: readonly Uint8Array[], budget: SofficeBudget): SofficeInvocation {
  budget.checkpoint();
  const decoded: string[] = [];
  let retained = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    for (const arg of args) {
      budget.charge('work', 1 + arg.byteLength);
      budget.charge('argumentBytes', arg.byteLength);
      // UTF-16 storage is at most twice the input byte length. Reserve before decoding.
      const reservation = 2 * arg.byteLength;
      budget.charge('retainedBytes', reservation);
      retained += reservation;
      let text: string;
      try { text = decoder.decode(arg); }
      catch { throw new SofficeError('invalid-argument', 'invalid UTF-8 argument'); }
      if (text.includes('\0')) throw new SofficeError('invalid-argument', 'NUL in argument');
      decoded.push(text);
    }
    return parseEvents(decoded, budget);
  } catch (error) {
    budget.releaseRetainedBytes(retained);
    throw error;
  }
}

function parseEvents(args: readonly string[], budget: SofficeBudget): SofficeInvocation {
  let literal = false;
  let event: FileEvent = 'open', headless = false, help = false, version = false, textCat = false, scriptCat = false;
  let conversion: ConversionParameters | undefined;
  const importFilters: { name: string; options: string }[] = [];
  let outdir: string | undefined;
  const files: { path: string; event: FileEvent }[] = [], warnings: string[] = [];
  for (let index = 0; index < args.length; index++) {
    budget.charge('work', 1);
    const arg = args[index]!;
    const operand = () => {
      const value = args[++index];
      if (value === undefined || value.length === 0) throw new SofficeError('invalid-argument', 'missing operand', arg);
      return value;
    };
    if (!literal && arg === '--') { literal = true; continue; }
    if (literal || arg === '-' || !arg.startsWith('-')) {
      budget.charge('files', 1); files.push({ path: arg, event }); continue;
    }
    if (arg === '-h' || arg === '-?') { help = true; continue; }
    if (arg === '-n') { event = 'new'; continue; }
    if (arg === '-o') { event = 'open'; continue; }
    if (arg === '-p' || arg.startsWith('-env:')) throw new SofficeError('unsupported', 'host capability denied', arg);
    const option = arg.slice(arg.startsWith('--') ? 2 : 1);
    if (!arg.startsWith('--')) warnings.push('deprecated single-dash option: ' + arg);
    if (option === 'headless') headless = true;
    else if (option === 'help') help = true;
    else if (option === 'version') version = true;
    else if (['invisible', 'nologo', 'norestore', 'nodefault', 'nolockcheck'].includes(option)) { /* inert compatibility flags */ }
    else if (option === 'convert-to') {
      const format = descriptor(operand()), output = descriptor(format.options);
      if (!format.name || [...format.name].some(char => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.includes(char))) throw new SofficeError('invalid-argument', 'invalid output extension');
      conversion = { extension: format.name, filter: output.name, options: output.options };
      event = 'conversion'; headless = true;
    } else if (option === 'outdir') {
      if (event !== 'conversion') throw new SofficeError('invalid-argument', '--outdir must directly follow --convert-to (printing is denied)');
      outdir = operand();
    } else if (option.startsWith('infilter=')) {
      const importFilter = descriptor(option.slice('infilter='.length));
      if (!importFilter.name) throw new SofficeError('invalid-argument', 'empty import filter');
      importFilters.push(importFilter);
    } else if (option === 'cat') {
      conversion = { extension: 'txt', filter: 'Text', options: '' }; event = 'conversion'; textCat = true; headless = true;
    } else if (option === 'script-cat') { event = 'conversion'; scriptCat = true; headless = true; }
    else if (['accept', 'unaccept', 'display', 'printer-name', 'pt', 'print-to-file', 'show'].some(name => option === name || option.startsWith(name + '='))) throw new SofficeError('unsupported', 'host capability denied', arg);
    else throw new SofficeError('invalid-argument', 'unknown option', arg);
  }
  return { files, headless, help, version, warnings, importFilters, textCat, scriptCat,
    ...(conversion ? { conversion } : {}), ...(outdir !== undefined ? { outdir } : {}) };
}
