import { FoldError, validateLimits, type FoldLimits, type FoldOptions, type FoldMode } from './contracts.js';
export function parseFoldArguments(args: readonly string[], limits: FoldLimits): FoldOptions {
  validateLimits(limits);
  let size = 0;
  // Admission precedes encoder allocation, including astral and lone-surrogate strings.
  for (const arg of args) {
    size++;
    for (const ch of arg) {
      const cp = ch.codePointAt(0)!; size += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
      if (size > limits.argumentBytes || size > limits.work) throw new FoldError('LIMIT', 'Argument byte/work limit exceeded');
    }
    if (size > limits.argumentBytes || size > limits.work) throw new FoldError('LIMIT', 'Argument byte limit exceeded');
  }
  let width = 80, mode: FoldMode = 'columns', spaces = false, ended = false;
  const files: string[] = [];
  const setWidth = (value: string): void => {
    let i = 0;
    while (' \t\r\n\v\f'.includes(value[i] ?? '\u0000')) i++;
    if (value[i] === '+') i++;
    const start = i;
    let number = 0n;
    for (; i < value.length; i++) {
      const digit = value.charCodeAt(i) - 48;
      if (digit < 0 || digit > 9) throw new FoldError('WIDTH', 'Width must be a positive decimal integer');
      number = number * 10n + BigInt(digit);
      if (number > 18446744073709551606n) throw new FoldError('WIDTH', 'Width exceeds released 64-bit native range');
    }
    if (start === i || number === 0n) throw new FoldError('WIDTH', 'Width must be at least 1');
    if (number > BigInt(Number.MAX_SAFE_INTEGER)) throw new FoldError('LIMIT', 'Width exceeds checked arithmetic admission');
    width = Number(number);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (ended || arg === '-' || !arg.startsWith('-')) { files.push(arg); continue; }
    if (arg === '--') { ended = true; continue; }
    if (arg.startsWith('--')) {
      const equal = arg.indexOf('=');
      const name = arg.slice(2, equal < 0 ? undefined : equal);
      const matches = ['bytes', 'characters', 'spaces', 'width'].filter(n => name.length > 0 && n.startsWith(name));
      if (matches.length !== 1) throw new FoldError('OPTION', `Unavailable option: ${arg}`);
      const option = matches[0]!;
      if (option === 'width') {
        const value = equal < 0 ? args[++i] : arg.slice(equal + 1);
        if (value === undefined) throw new FoldError('OPTION', 'Width requires an argument');
        setWidth(value);
      } else {
        if (equal >= 0) throw new FoldError('OPTION', `Option takes no argument: ${arg}`);
        if (option === 'spaces') spaces = true; else mode = option === 'bytes' ? 'bytes' : 'characters';
      }
      continue;
    }
    for (let j = 1; j < arg.length; j++) {
      const ch = arg[j]!;
      if (ch === 'b') mode = 'bytes';
      else if (ch === 'c') mode = 'characters';
      else if (ch === 's') spaces = true;
      else if (ch === 'w') {
        const value = j + 1 < arg.length ? arg.slice(j + 1) : args[++i];
        if (value === undefined) throw new FoldError('OPTION', 'Width requires an argument');
        setWidth(value); break;
      } else if (ch >= '0' && ch <= '9') {
        setWidth(arg.slice(j)); break;
      } else throw new FoldError('OPTION', `Unavailable option: -${ch}`);
    }
  }
  return Object.freeze({ width, mode, spaces, files: Object.freeze(files) });
}
