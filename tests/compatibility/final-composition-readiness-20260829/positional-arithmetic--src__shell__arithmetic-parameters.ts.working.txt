import { prepareArithmetic } from "./arithmetic.js";
import type { ArithmeticProgram } from "./arithmetic.js";
import type { Admission, ArrayOwner } from "./arrays/ledger.js";

interface PositionalArithmeticOptions {
  readonly positional: readonly string[];
  readonly arg0: string;
  readonly maximumBytes: number;
  readonly owner: ArrayOwner | undefined;
  readonly checkpoint: () => void;
  readonly requireParameter: (name: string, value: string | undefined) => void;
  readonly limit: () => never;
}

function digit(source: string, position: number): boolean {
  const code = source.charCodeAt(position);
  return code >= 48 && code <= 57;
}

function positionalTemplate(source: string, checkpoint: () => void): boolean {
  let found = false;
  let nextCheckpoint = 0;
  for (let position = 0; position < source.length;) {
    if (position >= nextCheckpoint) { checkpoint(); nextCheckpoint = position + 128; }
    const character = source[position];
    if (character === "\\" || character === "'" || character === '"' || character === "`") return false;
    if (character !== "$") { position++; continue; }
    position++;
    if (digit(source, position)) { found = true; position++; continue; }
    if (source[position] !== "{") return false;
    const start = ++position;
    while (digit(source, position)) {
      if (position >= nextCheckpoint) { checkpoint(); nextCheckpoint = position + 128; }
      position++;
    }
    if (position === start || source[position] !== "}") return false;
    found = true;
    position++;
  }
  return found;
}

function positionalValue(name: string, options: PositionalArithmeticOptions): string | undefined {
  let index = 0;
  let outside = false;
  for (let position = 0; position < name.length; position++) {
    if (position % 128 === 0) options.checkpoint();
    const next = name.charCodeAt(position) - 48;
    if (index > Math.floor((options.positional.length - next) / 10)) outside = true;
    if (!outside) index = index * 10 + next;
  }
  return outside ? undefined : index === 0 ? options.arg0 : options.positional[index - 1];
}

export function evaluatePositionalArithmetic(
  program: ArithmeticProgram,
  options: PositionalArithmeticOptions,
  evaluate: (prepared: ArithmeticProgram) => bigint,
): bigint {
  const source = program.source;
  if (!source.includes("$")) return evaluate(program);
  options.checkpoint();
  if (!positionalTemplate(source, options.checkpoint)) return evaluate(program);
  const header = options.owner?.reserve({ metadata: 128, allocatedSlots: 2, work: source.length * 2 + 8 });
  const admissions: Admission[] = [];
  const chunks: string[] = [];
  let bytes = 0;
  const reserve = (payload: number): void => {
    const admission = options.owner?.reserve({ payload, metadata: 64, allocatedSlots: 2, work: 4 });
    if (admission) admissions.push(admission);
  };
  const length = (text: string, start: number, end: number, maximum: number): number => {
    let size = 0;
    let nextCheckpoint = start;
    for (let position = start; position < end;) {
      if (position >= nextCheckpoint) { options.checkpoint(); nextCheckpoint = position + 128; }
      const code = text.charCodeAt(position++);
      if (code <= 0x7f) size++;
      else if (code <= 0x7ff) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff && position < end && text.charCodeAt(position) >= 0xdc00 && text.charCodeAt(position) <= 0xdfff) { size += 4; position++; }
      else size += 3;
      if (size > maximum) options.limit();
    }
    options.owner?.reserve({ work: end - start }).release();
    return size;
  };
  const literal = (start: number, end: number): void => {
    if (start === end) return;
    const size = length(source, start, end, options.maximumBytes - bytes);
    reserve(size);
    chunks.push(source.slice(start, end));
    bytes += size;
  };
  try {
    let start = 0;
    let nextCheckpoint = 0;
    for (let position = 0; position < source.length;) {
      if (position >= nextCheckpoint) { options.checkpoint(); nextCheckpoint = position + 128; }
      if (source[position] !== "$") { position++; continue; }
      literal(start, position);
      const braced = source[position + 1] === "{";
      const nameStart = position + (braced ? 2 : 1);
      let nameEnd = nameStart + 1;
      if (braced) while (digit(source, nameEnd)) { if (nameEnd >= nextCheckpoint) { options.checkpoint(); nextCheckpoint = nameEnd + 128; } nameEnd++; }
      reserve(nameEnd - nameStart);
      const name = source.slice(nameStart, nameEnd);
      const value = positionalValue(name, options);
      options.requireParameter(name, value);
      const text = value ?? "";
      const size = length(text, 0, text.length, options.maximumBytes - bytes);
      reserve(size);
      chunks.push(text);
      bytes += size;
      position = nameEnd + (braced ? 1 : 0);
      start = position;
    }
    literal(start, source.length);
    options.checkpoint();
    reserve(bytes);
    const expanded = chunks.join("");
    options.checkpoint();
    return evaluate(prepareArithmetic(expanded));
  } finally {
    for (let position = admissions.length - 1; position >= 0; position--) admissions[position]!.release();
    header?.release();
  }
}
