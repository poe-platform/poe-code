import { TesseractError } from './contracts.js';
const psmNames = ['osd_only', 'auto_osd', 'auto_only', 'auto', 'single_column', 'single_block_vert_text', 'single_block', 'single_line', 'single_word', 'circle_word', 'single_char', 'sparse_text', 'sparse_text_osd', 'raw_line'];
const oemNames = ['tesseract_only', 'lstm_only', 'tesseract_lstm_combined', 'default'];
export interface TesseractArguments {
  readonly action: 'recognize' | 'help' | 'version' | 'list-langs';
  readonly input: string | undefined;
  readonly outputbase: string | undefined;
  readonly language: string;
  readonly psm: number;
  readonly oem: number;
  readonly dpi: number | undefined;
  readonly tessdataDirectory: string | undefined;
  readonly variables: readonly { readonly name: string; readonly value: string }[];
  readonly configs: readonly string[];
}
function decimal(value: string, minimum: number, maximum: number): number {
  if (!value.length || [...value].some(character => character < '0' || character > '9')) throw new TesseractError('invalid-argument', 'invalid numeric value: ' + value);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new TesseractError('invalid-argument', 'numeric value out of range: ' + value);
  return number;
}
function mode(value: string, names: readonly string[]): number {
  const named = names.indexOf(value);
  return named >= 0 ? named : decimal(value, 0, names.length - 1);
}
/** Native positional order; strict UTF-8 text admission and DPI are deliberate safe deviations. */
export function parseTesseractArguments(args: readonly string[], limits: { readonly maxArgumentBytes?: number; readonly defaultPsm?: 3 | 6 } = {}): TesseractArguments {
  const maximum = limits.maxArgumentBytes ?? 65536;
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new TesseractError('limit', 'invalid argumentBytes', 'argumentBytes');
  // Count UTF-8 without allocating encoded argv. Reject NUL and unpaired surrogates.
  let size = 0;
  for (const arg of args) {
    for (const character of arg) {
      const point = character.codePointAt(0)!;
      if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) throw new TesseractError('invalid-argument', 'invalid argv text');
      size += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
      if (size > maximum) throw new TesseractError('limit', 'exhausted argumentBytes', 'argumentBytes');
    }
    size += 1;
    if (size > maximum) throw new TesseractError('limit', 'exhausted argumentBytes', 'argumentBytes');
  }
  let input: string | undefined, outputbase: string | undefined, dpi: number | undefined, tessdataDirectory: string | undefined;
  let psm: number = limits.defaultPsm ?? 3, oem = 3, language = 'eng';
  let action: TesseractArguments['action'] = args.length ? 'recognize' : 'help';
  let languageExplicit = false;
  let literal = false;
  const variables: { name: string; value: string }[] = [];
  let configs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!literal && arg === '--') { literal = true; continue; }
    if (literal) {
      if (input === undefined) { input = arg; outputbase = args[++index]; }
      else { configs = args.slice(index); break; }
      continue;
    }
    const next = (): string => {
      const value = args[++index];
      if (value === undefined) throw new TesseractError('invalid-argument', 'missing value for ' + arg);
      return value;
    };
    if (arg === '--help' || arg === '-h' || arg === '--help-extra' || arg === '--help-psm' || arg === '--help-oem') { action = 'help'; break; }
    if (arg === '--version' || arg === '-v') { action = 'version'; break; }
    if (arg === '--list-langs') { action = 'list-langs'; continue; }
    if (arg === '-l') { language = next(); languageExplicit = true; }
    else if (arg === '--psm') psm = mode(next(), psmNames);
    else if (arg === '--oem') oem = mode(next(), oemNames);
    else if (arg === '--dpi') dpi = decimal(next(), 1, 2400);
    else if (arg === '--tessdata-dir') tessdataDirectory = next();
    else if (arg === '-c') {
      const assignment = next(), split = assignment.indexOf('=');
      if (split < 1) throw new TesseractError('invalid-argument', 'expected name=value');
      variables.push({ name: assignment.slice(0, split), value: assignment.slice(split + 1) });
    } else if (arg.startsWith('-') && arg !== '-') throw new TesseractError('invalid-argument', 'unknown option: ' + arg);
    else if (input === undefined) {
      input = arg;
      outputbase = args[++index]; // Consumed even when option-like.
    } else { configs = args.slice(index); break; }
  }
  if (psm === 0 && !languageExplicit) language = 'osd';
  if (input?.includes('://')) throw new TesseractError('unsupported', 'implicit URL input is denied');
  if (action === 'recognize' && (!input || outputbase === undefined || !outputbase)) throw new TesseractError('invalid-argument', 'input and outputbase are required');
  return { action, input, outputbase, language, psm, oem, dpi, tessdataDirectory, variables, configs };
}

/** FixPageSegMode after config loading; configured 6 retains the CLI choice. */
export function resolveTesseractPageSegMode(commandLine: number, configured: number): number {
  for (const value of [commandLine, configured]) {
    if (!Number.isInteger(value) || value < 0 || value > 13) throw new TesseractError('invalid-argument', 'invalid page segmentation mode');
  }
  return configured === 6 ? commandLine : configured;
}
