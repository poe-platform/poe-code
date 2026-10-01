import type { ByteSource } from 'safe-bash-contracts/io';
import type { Arguments } from './argv.js';
import { unsigned } from './argv.js';
import { Budget, XanError } from './budget.js';
import { condition } from './condition.js';
import type { RecordRow } from './csv.js';
import { Scanner } from './csv.js';
import type { InputScope } from './io.js';
import { parseSelection, resolveSelection } from './selector.js';
import { boundedSort } from './sort.js';
import type { Writer } from './writer.js';
import { emitted, textRow, cellText, compareBytes, decimalNumber } from './cells.js';
import { summarize } from './summary.js';

function numericCell(bytes: Uint8Array, budget: Budget): number {
  budget.hold(bytes.length * 4);
  try {
    const value = decimalNumber(cellText(bytes, budget), budget);
    if (value === undefined) throw new XanError('could not parse cell as number');
    return value;
  } finally { budget.release(bytes.length * 4); }
}
async function positions(selection: string, first: RecordRow | undefined, args: Arguments, budget: Budget): Promise<number[]> {
  budget.hold((first?.width ?? 0) * 32);
  try { return await resolveSelection(await parseSelection(selection, budget), first?.cells.map(cell => cell.decoded.view()) ?? [], args.noHeaders, budget); }
  finally { budget.release((first?.width ?? 0) * 32); }
}
async function* data(scanner: Scanner, first: RecordRow | undefined, noHeaders: boolean): AsyncGenerator<RecordRow> {
  let row = noHeaders ? first : await scanner.next();
  try {
    while (row) {
      if (row.width !== first?.width) throw new XanError(`CSV error: record ${row.number}: inconsistent field count`);
      yield row;
      row = await scanner.next();
    }
  } finally { row?.free(); }
}
async function contains(bytes: Uint8Array, pattern: Uint8Array, exact: boolean, budget: Budget): Promise<boolean> {
  if (exact && bytes.length !== pattern.length) return false;
  for (let start = 0; start <= bytes.length - pattern.length; start++) {
    let same = true;
    for (let i = 0; i < pattern.length; i++) {
      budget.work();
      if (bytes[start + i] !== pattern[i]) { same = false; break; }
      if ((i & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
    }
    if (same) return true;
    budget.work(); const c = budget.checkpoint(); if (c) await c;
  }
  return false;
}

export async function* transformRows(args: Arguments, scope: InputScope, budget: Budget, writer: Writer): ByteSource {
  const options = args.options!;
  const scanner = scope.open(args.inputs[0]!, args);
  const first = await scanner.next();
  if (first) scope.own(first.free);
  const selected = await positions(args.selection, first, args, budget);
  const source = data(scanner, first, args.noHeaders);
  const retained: RecordRow[] = [];
  const cleanup = (): void => { for (const row of retained) { row.free(); budget.release(32); } retained.length = 0; };
  scope.own(cleanup);
  try {
    if (args.command === 'join') { yield* join(args, source, first, selected, scope, budget, writer); return; }
    if (args.command === 'freq' || args.command === 'stats') { yield* summarize(args, source, first, selected, budget, writer); return; }
    if (args.command === 'rename') {
      // Parse replacement names as a single CSV record, including quoted commas.
      const bytes = await budget.encode(args.operand!);
      const names = new Scanner({ async *[Symbol.asyncIterator]() { yield bytes; } }, 44, 'rename', budget);
      let replacement: RecordRow | undefined;
      try {
        replacement = await names.next();
        const extra = await names.next();
        if (extra) extra.free();
        if (replacement?.width !== selected.length || extra) throw new XanError('replacement names must match selected columns');
        budget.hold(selected.length * 32 + (first?.width ?? 0) * 32);
        try {
          const replacements = new Map(selected.map((column, index) => [column, replacement!.cells[index]!.decoded.view()]));
          if (replacements.size !== selected.length) throw new XanError('rename selection contains duplicate columns');
          yield* textRow(first?.cells.map((cell, i) => replacements.get(i) ?? (args.noHeaders ? String(i) : cell.decoded.view())) ?? [], writer, budget);
        } finally { budget.release(selected.length * 32 + (first?.width ?? 0) * 32); }
      } finally { replacement?.free(); await names.close(); budget.release(bytes.length); }
    } else if (!args.noHeaders && first) yield* emitted(await writer.row(first.cells), budget);
    const predicate = args.command === 'filter' ? await condition(args.operand, first, args.noHeaders, budget, scope) : undefined;
    const pattern = args.command === 'search' ? await budget.encode(options.has('ignore-case') ? args.operand!.toLowerCase() : args.operand!) : undefined;
    if (pattern) scope.own(() => budget.release(pattern.length));
    const limit = options.has('limit') ? await unsigned(options.get('limit')!, '--limit', budget) : undefined;
    let matches = 0n;
    for await (const row of source) {
      let held = false;
      try {
        if (args.command === 'sort' || args.command === 'reverse') {
          if (options.has('numeric')) for (const position of selected) numericCell(row.cells[position]!.decoded.view(), budget);
          budget.hold(32); retained.push(row); held = true; continue;
        }
        let match = predicate ? await predicate(row) : true;
        if (pattern) {
          match = options.has('every-column');
          for (const position of selected) {
            let bytes = row.cells[position]!.decoded.view();
            let folded: Uint8Array | undefined;
            try {
              if (options.has('ignore-case')) {
                const size = bytes.length * 8; budget.hold(size);
                try { folded = await budget.encode(cellText(bytes, budget).toLowerCase()); }
                finally { budget.release(size); }
                bytes = folded;
              }
              const found = await contains(bytes, pattern, options.has('exact'), budget);
              if (options.has('every-column') ? !found : found) { match = found; break; }
            } finally { if (folded) budget.release(folded.length); }
          }
        }
        if (options.has('invert-match')) match = !match;
        if (match) {
          if (limit !== undefined && matches >= limit) break;
          yield* emitted(await writer.row(row.cells), budget); matches++;
          if (limit !== undefined && matches >= limit) break;
        }
      } finally { if (!held) row.free(); }
    }
    const compare = async (left: RecordRow, right: RecordRow): Promise<number> => {
      for (const position of selected) {
        const a = left.cells[position]!.decoded.view(), b = right.cells[position]!.decoded.view();
        let order: number;
        if (options.has('numeric')) {
          order = Math.sign(numericCell(a, budget) - numericCell(b, budget));
        } else order = await compareBytes(a, b, budget);
        if (order) return options.has('reverse') ? -order : order;
      }
      return 0;
    };
    if (args.command === 'sort') await boundedSort(retained, 32, budget, compare);
    for (let i = 0; i < retained.length; i++) {
      budget.work(); const c = budget.checkpoint(); if (c) await c;
      const row = retained[args.command === 'reverse' ? retained.length - i - 1 : i]!;
      if (options.has('uniq') && i && await compare(retained[i - 1]!, row) === 0) continue;
      yield* emitted(await writer.row(row.cells), budget);
    }
  } finally { await source.return(undefined); cleanup(); first?.free(); await scanner.close(); }
}

async function* join(args: Arguments, left: AsyncGenerator<RecordRow>, first: RecordRow | undefined, leftKeys: number[], scope: InputScope, budget: Budget, writer: Writer): ByteSource {
  const options = args.options!;
  const scanner = scope.open(args.inputs[1]!, args);
  const rightFirst = await scanner.next();
  if (rightFirst) scope.own(rightFirst.free);
  const rightKeys = await positions(args.rightSelection ?? '', rightFirst, args, budget);
  if (!options.has('cross') && leftKeys.length !== rightKeys.length) throw new XanError('join key selections have different widths');
  let drop = options.get('drop-key') ?? 'none';
  if (!options.has('drop-key') && !args.noHeaders && !options.has('ignore-case') && !options.has('full') && !options.has('cross') && !options.has('semi') && !options.has('anti')) {
    let same = true;
    for (let i = 0; i < leftKeys.length; i++) if (await compareBytes(first!.cells[leftKeys[i]!]!.decoded.view(), rightFirst!.cells[rightKeys[i]!]!.decoded.view(), budget)) same = false;
    if (same) drop = options.has('right') ? 'left' : 'right';
  }
  const lcols = await positions('', first, args, budget), rcols = await positions('', rightFirst, args, budget);
  budget.hold((lcols.length + rcols.length + leftKeys.length + rightKeys.length) * 64);
  const leftSet = new Set(leftKeys), rightSet = new Set(rightKeys);
  budget.work(leftKeys.length + rightKeys.length);
  const keepLeft: number[] = [], keepRight: number[] = [];
  for (const i of lcols) { budget.work(); if (!['left', 'both'].includes(drop) || !leftSet.has(i)) keepLeft.push(i); const c = budget.checkpoint(); if (c) await c; }
  for (const i of rcols) { budget.work(); if (!['right', 'both'].includes(drop) || !rightSet.has(i)) keepRight.push(i); const c = budget.checkpoint(); if (c) await c; }
  const semi = options.has('semi') || options.has('anti');
  const index = new Map<string, RecordRow[]>(), rows: RecordRow[] = [], matched = new Set<RecordRow>();
  let held = 0;
  const hold = (bytes: number): void => { budget.hold(bytes); held += bytes; };
  const key = async (row: RecordRow, columns: number[]): Promise<string | undefined> => {
    let result = '', nonempty = false;
    for (const i of columns) {
      const bytes = row.cells[i]!.decoded.view(); nonempty ||= bytes.length > 0;
      // Length-prefixed byte strings preserve invalid UTF-8 and composite boundaries.
      let value = '';
      if (options.has('ignore-case')) value = cellText(bytes, budget).toLowerCase();
      else for (let j = 0; j < bytes.length; j++) { budget.work(); value += String.fromCharCode(bytes[j]!); if ((j & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; } }
      result += `${value.length}:${value}`;
    }
    return nonempty || options.has('nulls') ? result : undefined;
  };
  const output = async function* (a: RecordRow | undefined, b: RecordRow | undefined): ByteSource {
    budget.hold((keepLeft.length + keepRight.length) * 32);
    try { yield* textRow([...keepLeft.map(i => a?.cells[i]?.decoded.view() ?? ''), ...(semi ? [] : keepRight.map(i => b?.cells[i]?.decoded.view() ?? ''))], writer, budget); }
    finally { budget.release((keepLeft.length + keepRight.length) * 32); }
  };
  try {
    if (!args.noHeaders) yield* output(first, rightFirst);
    for await (const row of data(scanner, rightFirst, args.noHeaders)) {
      let retained = false;
      try {
        hold(row.cells.reduce((n, cell) => n + cell.decoded.length * 8 + 64, 128));
        rows.push(row); retained = true;
        const value = await key(row, rightKeys);
        if (value !== undefined) { const group = index.get(value); if (group) group.push(row); else index.set(value, [row]); }
      } finally { if (!retained) row.free(); }
    }
    for await (const row of left) {
      try {
        budget.hold(row.cells.reduce((n, cell) => n + cell.decoded.length * 8 + 64, 0));
        let value: string | undefined;
        try {
        value = await key(row, leftKeys);
        const matches = options.has('cross') ? rows : value === undefined ? [] : index.get(value) ?? [];
        if (semi) { if (options.has('anti') ? !matches.length : matches.length) yield* output(row, undefined); }
        else if (matches.length) for (const other of matches) { budget.work(); matched.add(other); yield* output(row, other); }
        else if (options.has('left') || options.has('full')) yield* output(row, undefined);
        } finally { budget.release(row.cells.reduce((n, cell) => n + cell.decoded.length * 8 + 64, 0)); }
      } finally { row.free(); }
    }
    if (options.has('right') || options.has('full')) for (const row of rows) if (!matched.has(row)) yield* output(undefined, row);
  } finally { for (const row of rows) row.free(); rightFirst?.free(); budget.release(held); await scanner.close(); }
}
