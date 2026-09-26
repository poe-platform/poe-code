import type { ByteSource } from "../../contracts/io.js";
import type { Arguments } from "./argv.js";
import { checkedAdd, inferDelimiter } from "./argv.js";
import { Budget, XanError } from "./budget.js";
import type { RecordRow, Scanner } from "./csv.js";
import type { InputScope } from "./io.js";
import type { Selection } from "./selector.js";
import { resolveSelection } from "./selector.js";
import { Writer } from "./writer.js";
import { boundedSort } from "./sort.js";

async function* emitted(bytes: Uint8Array, budget: Budget): ByteSource {
  try { if (bytes.length) yield bytes; } finally { budget.release(bytes.length); }
}
function width(row: RecordRow, expected: number): void {
  if (row.width !== expected) throw new XanError(`CSV error: record ${row.number} (byte: ${row.offset}): found record with ${row.width} fields, but the previous record has ${expected} fields`);
}
export async function prepareRows(args: Arguments, selection: Selection | undefined, scope: InputScope, budget: Budget, writer: Writer): Promise<ByteSource> {
  if (args.help) return emitted(await writer.text("xan: bounded CSV headers (h), count, select, slice\nCommon: -h --help, -d --delimiter BYTE, -o --output PATH\nheaders: -j --just-names, --csv, -s --start N, --color auto|never\ncount/select/slice: -n --no-headers\ncount: -H/--human-readable, -c/--check-alignment, -a/--approx, -p/--parallel, -t/--threads N\nselect: literal selection or -e/--evaluate COLUMN, -f/--evaluate-file PATH;\nslice: -s/--start, --skip, -e/--end, -l/--len, -i/--index, -I/--indices, -L/--last\nslice bytes: -B/--byte-offset N, --end-byte N, --raw\nslice conditions: -S/--start-condition EXPR, -E/--end-condition EXPR\nConditions: named column comparisons with string/number literals.\nOther expressions, advanced formats and forced color are unsupported.\nCount execution options use exact sequential counting.\n"), budget);
  if (args.command === "headers") return prepareHeaders(args, scope, budget, writer);
  if (args.command === "slice" && !args.raw && args.noHeaders && args.last === 0) return emitted(new Uint8Array(0), budget);
  let scanner = scope.open(args.inputs[0]!, args);
  if (args.command === "count") {
    let count = 0;
    let expected: number | undefined;
    while (true) {
      const row = await scanner.next(); if (!row) break;
      try {
        expected ??= row.width;
        if (args.checkAlignment) width(row, expected);
        count++;
      } finally { row.free(); }
    }
    await scanner.close();
    count = Math.max(0, count - (args.noHeaders ? 0 : 1));
    let text = String(count);
    if (args.humanReadable && !args.parallel) {
      text = count.toLocaleString("en-US");
      if (count >= 10000) {
        const scale = count >= 1000000 ? 1000000 : 1000;
        const rounded = Math.round(count / scale * 10) / 10;
        text += ` (${rounded}${scale === 1000 ? "k" : "M"})`;
      }
    }
    return emitted(await writer.text(`${text}\n`), budget);
  }
  const first = args.raw && args.noHeaders ? undefined : await scanner.next();
  if (first) scope.own(first.free);
  let positions: number[] | undefined;
  try {
    if (selection && (first || !args.noHeaders)) {
      const metadata = (first?.width ?? 0) * 32;
      budget.hold(metadata);
      try { positions = await resolveSelection(selection, first?.cells.map(cell => cell.decoded.view()) ?? [], args.noHeaders, budget); }
      finally { budget.release(metadata); }
    }
  } catch (error) { first?.free(); throw error; }
  const startCondition = args.raw || args.last !== undefined ? undefined : await condition(args.startCondition, first, args.noHeaders, budget, scope);
  const endCondition = args.raw || args.last !== undefined ? undefined : await condition(args.endCondition, first, args.noHeaders, budget, scope);
  if (args.byteOffset !== undefined && (args.raw || args.last === undefined)) {
    await scanner.close();
    scanner = scope.open(args.inputs[0]!, args);
    await scanner.position(args.byteOffset, args.endByte);
  }
  if (args.raw) return (async function* (): ByteSource {
    try {
      if (!args.noHeaders) yield* emitted(await writer.row(first?.cells ?? []), budget);
      first?.free();
      yield* scanner.raw();
    } finally { first?.free(); await scanner.close(); }
  })();
  return rows(args, scanner, first, positions, budget, writer, startCondition, endCondition);
}
async function* rows(args: Arguments, scanner: Scanner, first: RecordRow | undefined, positions: number[] | undefined, budget: Budget, writer: Writer, startCondition?: (row: RecordRow) => Promise<boolean>, endCondition?: (row: RecordRow) => Promise<boolean>): ByteSource {
  const expected = first?.width ?? 0;
  const ring: RecordRow[] = [];
  let ringCursor = 0;
  let current = first;
  if (args.byteOffset !== undefined && args.last === undefined) current = undefined;
  let started = !startCondition;
  const raw = args.command === "select" && !args.evaluate && !args.evaluateFile && (args.delimiter ?? inferDelimiter(args.inputs[0]!)) === 44 && writer.delimiter === 44;
  try {
    if (!args.noHeaders) {
      yield* emitted(await writer.row(first?.cells ?? [], positions), budget);
      first?.free(); current = undefined;
    }
    if (args.byteOffset !== undefined && args.noHeaders && args.last === undefined) first?.free();
    if (args.last === 0) return;
    if (!first) return;
    let index = 0n;
    let wanted = 0;
    while (true) {
      current ??= await scanner.next();
      if (!current) break;
      width(current, expected);
      if (!started) {
        started = await startCondition!(current);
        if (!started) { current.free(); current = undefined; continue; }
      }
      if (endCondition && await endCondition(current)) break;
      if (args.command === "select") yield* emitted(await writer.row(current.cells, positions, raw), budget);
      else if (args.last !== undefined) {
        if (ring.length < args.last) { budget.hold(32); ring.push(current); }
        else { ring[ringCursor]!.free(); ring[ringCursor] = current; ringCursor = (ringCursor + 1) % args.last; }
        current = undefined;
      } else if (args.indices) {
        if (args.indices[wanted] === index) { yield* emitted(await writer.row(current.cells), budget); wanted++; }
      } else if (index >= args.start) yield* emitted(await writer.row(current.cells), budget);
      current?.free(); current = undefined;
      index++;
      if (args.command === "slice" && args.last === undefined) {
        if (args.indices && wanted === args.indices.length) break;
        if (!args.indices && args.end !== undefined && index === args.end && index > args.start) break;
      }
    }
    for (let offset = 0; offset < ring.length; offset++) {
      const row = ring[(ringCursor + offset) % ring.length]!;
      yield* emitted(await writer.row(row.cells), budget);
    }
  } finally {
    current?.free(); first?.free();
    for (const row of ring) { row.free(); budget.release(32); }
    if (positions) budget.release(positions.length * 8);
    await scanner.close();
  }
}
const whitespace = (code: number): boolean => (code >= 9 && code <= 13) || code === 32 || code === 133 || code === 160 || code === 5760 || (code >= 8192 && code <= 8202) || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288;
async function sanitize(text: string, budget: Budget): Promise<string> {
  const parts: string[] = [];
  let normalizedLength = 0;
  let segment = "";
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    const part = code === 173 || (code < 32 && !whitespace(code)) ? "" : code === 10 ? "\\n" : code === 13 ? "\\r" : code === 9 ? "\\t" : code === 12 ? "\\f" : text[offset]!;
    budget.hold(part.length * 2); budget.work(part.length); segment += part; normalizedLength += part.length;
    if (segment.length >= 4096) { budget.hold(32); parts.push(segment); segment = ""; }
    if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
  }
  if (segment) { budget.hold(32); parts.push(segment); }
  budget.hold(normalizedLength * 2);
  for (let offset = 0; offset < normalizedLength; offset += 4096) { budget.work(Math.min(4096, normalizedLength - offset)); { const c = budget.checkpoint(); if (c) await c; } }
  text = parts.join("");
  budget.release(normalizedLength * 2 + parts.length * 32);
  parts.length = 0;
  let start = 0;
  let end = text.length;
  while (start < end && whitespace(text.charCodeAt(start))) { budget.work(); start++; }
  while (end > start && whitespace(text.charCodeAt(end - 1))) { budget.work(); end--; }
  let result = "";
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    let part: string;
    if (offset < start || offset >= end) part = "·".repeat(code < 128 ? 1 : code < 2048 ? 2 : 3);
    else part = text[offset]!;
    budget.hold(part.length * 2); budget.work(part.length); result += part;
    if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
  }
  budget.release(normalizedLength * 2);
  return result;
}
async function decodeHeader(bytes: Uint8Array, field: number, budget: Budget): Promise<string> {
  for (let offset = 0; offset < bytes.length;) {
    const first = bytes[offset]!;
    budget.work();
    let width = first < 128 ? 1 : first >= 194 && first <= 223 ? 2 : first >= 224 && first <= 239 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
    if (offset + width > bytes.length) width = 0;
    for (let index = 1; index < width; index++) {
      budget.work(); const byte = bytes[offset + index]!;
      if (byte < 128 || byte > 191 || (index === 1 && ((first === 224 && byte < 160) || (first === 237 && byte > 159) || (first === 240 && byte < 144) || (first === 244 && byte > 143)))) { width = 0; break; }
    }
    if (!width) throw new XanError(`CSV parse error: record 0 (line 1, field: ${field}, byte: 0): invalid utf-8: invalid UTF-8 in field ${field} near byte index ${offset}`);
    offset += width;
    { const c = budget.checkpoint(); if (c) await c; }
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const metadata = Math.ceil(bytes.length / 4096) * 32;
  budget.hold(bytes.length * 2 + metadata);
  const parts: string[] = [];
  let length = 0;
  try {
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const fragment = bytes.subarray(offset, offset + 4096);
      budget.work(fragment.length);
      const part = decoder.decode(fragment, { stream: offset + 4096 < bytes.length });
      parts.push(part); length += part.length; { const c = budget.checkpoint(); if (c) await c; }
    }
    budget.hold(length * 2);
    for (let offset = 0; offset < length; offset += 2048) { budget.work(Math.min(2048, length - offset) * 2); { const c = budget.checkpoint(); if (c) await c; } }
    return parts.join("");
  } finally { budget.release(bytes.length * 2 + metadata); }
}
interface Header { row?: RecordRow; names: string[]; display: string[] }
async function prepareHeaders(args: Arguments, scope: InputScope, budget: Budget, writer: Writer): Promise<ByteSource> {
  const headers: Header[] = [];
  try {
    for (const path of args.inputs) {
      const scanner = scope.open(path, args);
      const row = await scanner.next();
      if (row) scope.own(row.free);
      const header: Header = { ...(row ? { row } : {}), names: [], display: [] };
      budget.hold(32); headers.push(header);
      for (let index = 0; index < (row?.cells.length ?? 0); index++) {
        const bytes = row!.cells[index]!.decoded.view();
        budget.hold(32);
        const name = await decodeHeader(bytes, index, budget);
        header.names.push(name);
        header.display.push(args.csv ? "" : await sanitize(name, budget));
      }
      if (!args.csv && header.names.length) checkedAdd(args.start, BigInt(header.names.length - 1));
      await scanner.close();
    }
    return headerOutput(args, headers, budget, writer);
  } catch (error) { for (const header of headers) header.row?.free(); throw error; }
}
async function* headerOutput(args: Arguments, headers: Header[], budget: Budget, writer: Writer): ByteSource {
  try {
    const maximum = Math.max(0, ...headers.map(header => header.names.length));
    if (args.csv) {
      const paths: Uint8Array[] = [];
      try {
        for (const path of args.inputs) paths.push(await budget.encode(path === "-" ? "<stdin>" : path));
        yield* emitted(await writer.values(paths), budget);
      } finally { for (const path of paths) budget.release(path.length); }
      for (let index = 0; index < maximum; index++) {
        budget.hold(headers.length * 32);
        try { yield* emitted(await writer.values(headers.map(header => header.row?.cells[index]?.decoded.view() ?? new Uint8Array(0))), budget); }
        finally { budget.release(headers.length * 32); }
      }
      return;
    }
    const counts = new Map<string, { count: number; lastFile: number; bytes: Uint8Array; display: string }>();
    for (let file = 0; file < headers.length; file++) {
      const header = headers[file]!;
      if (headers.length > 1) yield* emitted(await writer.text(`${file ? "\n" : ""}${args.inputs[file] === "-" ? "<stdin>" : args.inputs[file]}\n`), budget);
      for (let index = 0; index < header.names.length; index++) {
        const name = header.names[index]!;
        if (headers.length > 1) {
          const previous = counts.get(name);
          if (previous) {
            if (previous.lastFile !== file) { previous.count++; previous.lastFile = file; }
          }
          else { budget.hold(32); counts.set(name, { count: 1, lastFile: file, bytes: header.row!.cells[index]!.decoded.view(), display: header.display[index]! }); }
        }
        const prefix = args.justNames ? "" : `${checkedAdd(args.start, BigInt(index))} `;
        yield* emitted(await writer.text(`${prefix}${header.display[index]}\n`), budget);
      }
    }
    if (headers.length > 1) {
      const same = [...counts.values()].every(value => value.count === headers.length);
      if (same) yield* emitted(await writer.text("\nAll files have the same headers!\n"), budget);
      else {
        budget.hold(counts.size * 32);
        const divergent = [...counts.values()].filter(value => value.count < headers.length);
        await boundedSort(divergent, 32, budget, async (left, right) => {
          for (let offset = 0; offset < Math.min(left.bytes.length, right.bytes.length); offset++) { budget.work(); const difference = left.bytes[offset]! - right.bytes[offset]!; if (difference) return difference; if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; } }
          return left.bytes.length - right.bytes.length;
        });
        yield* emitted(await writer.text("\nAll files don't have the same headers!\nDiverging headers: "), budget);
        for (let index = 0; index < divergent.length; index++) yield* emitted(await writer.text(`${index ? ", " : ""}${divergent[index]!.display}`), budget);
        yield* emitted(await writer.text("\n"), budget);
        budget.release(counts.size * 32);
      }
    }
    budget.release(counts.size * 32);
  } finally {
    for (const header of headers) {
      header.row?.free(); budget.release(32);
      for (const name of header.names) budget.release(name.length * 2 + 32);
      for (const display of header.display) budget.release(display.length * 2);
    }
  }
}

// Deliberately bounded Moonblade subset; never evaluates JavaScript or shell code.
async function condition(expression: string | undefined, headers: RecordRow | undefined, noHeaders: boolean, budget: Budget, scope: InputScope): Promise<((row: RecordRow) => Promise<boolean>) | undefined> {
  if (expression === undefined) return undefined;
  budget.bound('maxSelectorBytes', await budget.textSize(expression));
  let split = -1;
  let operator = '';
  for (let offset = 0; offset < expression.length; offset++) {
    budget.work();
    if (['=', '!', '<', '>'].includes(expression[offset]!)) {
      split = offset;
      operator = expression[offset]!;
      if (expression[offset + 1] === '=') operator += '=';
      break;
    }
  }
  if (split < 0 || !['==', '!=', '<', '<=', '>', '>='].includes(operator)) throw new XanError('unsupported condition: expected COLUMN comparison LITERAL');
  const name = expression.slice(0, split).trim();
  const literal = expression.slice(split + operator.length).trim();
  if (noHeaders) throw new XanError('named conditions require headers');
  const nameBytes = await budget.encode(name);
  let position = -1;
  try {
    for (let index = 0; index < (headers?.cells.length ?? 0); index++) {
      const bytes = headers!.cells[index]!.decoded.view();
      if (bytes.length !== nameBytes.length) continue;
      let same = true;
      for (let offset = 0; offset < bytes.length; offset++) { budget.work(); if (bytes[offset] !== nameBytes[offset]) same = false; }
      if (same) { position = index; break; }
    }
  } finally { budget.release(nameBytes.length); }
  if (position < 0) throw new XanError(`unknown condition column: ${name}`);
  let text: string;
  let numeric = false;
  if (literal.startsWith('"')) {
    try { const value: unknown = JSON.parse(literal); if (typeof value !== 'string') throw new Error(); text = value; }
    catch { throw new XanError('invalid condition string literal'); }
  } else if (literal.startsWith("'") && literal.endsWith("'") && literal.length >= 2) text = literal.slice(1, -1);
  else {
    if (!literal || !Number.isFinite(Number(literal))) throw new XanError('unsupported condition literal');
    text = literal; numeric = true;
  }
  const right = await budget.encode(text);
  scope.own(() => budget.release(right.length));
  return async row => {
    const left = row.cells[position]!.decoded.view();
    let order = 0;
    if (numeric) {
      budget.hold(left.length * 2);
      try {
        let value = '';
        for (let offset = 0; offset < left.length; offset++) { budget.work(); value += String.fromCharCode(left[offset]!); if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; } }
        const number = Number(value);
        if (!value.trim() || !Number.isFinite(number)) throw new XanError('condition requires a numeric cell');
        order = number < Number(text) ? -1 : number > Number(text) ? 1 : 0;
      } finally { budget.release(left.length * 2); }
    } else {
      for (let offset = 0; offset < Math.min(left.length, right.length); offset++) {
        budget.work();
        if (left[offset] !== right[offset]) { order = left[offset]! < right[offset]! ? -1 : 1; break; }
        if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
      }
      if (!order) order = left.length < right.length ? -1 : left.length > right.length ? 1 : 0;
    }
    return operator === '==' ? order === 0 : operator === '!=' ? order !== 0 : operator === '<' ? order < 0 : operator === '<=' ? order <= 0 : operator === '>' ? order > 0 : order >= 0;
  };
}
