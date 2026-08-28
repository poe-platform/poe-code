import type { ByteSource } from "../../contracts/io.js";
import type { Arguments } from "./argv.js";
import { checkedAdd, inferDelimiter } from "./argv.js";
import { Budget, XanError } from "./budget.js";
import type { RecordRow, Scanner } from "./csv.js";
import type { InputScope } from "./io.js";
import type { Selection } from "./selector.js";
import { resolveSelection } from "./selector.js";
import { Writer } from "./writer.js";

async function* emitted(bytes: Uint8Array, budget: Budget): ByteSource {
  try { if (bytes.length) yield bytes; } finally { budget.release(bytes.length); }
}
function width(row: RecordRow, expected: number, command: string): void {
  if (row.width !== expected) throw new XanError(`CSV error: record ${row.number} (byte: ${row.offset}): found record with ${row.width} fields, but the previous record has ${expected} fields`);
}
export async function prepareRows(args: Arguments, selection: Selection | undefined, scope: InputScope, budget: Budget, writer: Writer): Promise<ByteSource> {
  if (args.help) return emitted(await writer.text("xan: bounded CSV headers (h), count, select, slice\nCommon: -h --help, -d --delimiter BYTE, -o --output PATH\nheaders: -j --just-names, --csv, -s --start N, --color auto|never\ncount/select/slice: -n --no-headers\nselect: literal selection; slice: -s/--start, --skip, -e/--end, -l/--len, -i/--index, -I/--indices, -L/--last\nExpressions, advanced formats, parallel/approximate count and color are unsupported.\n"), budget);
  if (args.command === "headers") return prepareHeaders(args, scope, budget, writer);
  if (args.command === "slice" && args.noHeaders && args.last === 0) return emitted(new Uint8Array(0), budget);
  const scanner = scope.open(args.inputs[0]!, args);
  if (args.command === "count") {
    let count = 0;
    while (true) { const row = await scanner.next(); if (!row) break; count++; row.free(); }
    await scanner.close();
    return emitted(await writer.text(`${Math.max(0, count - (args.noHeaders ? 0 : 1))}\n`), budget);
  }
  const first = await scanner.next();
  let positions: number[] | undefined;
  try {
    if (selection) positions = await resolveSelection(selection, first?.cells.map(cell => cell.decoded.view()) ?? [], args.noHeaders, budget);
  } catch (error) { first?.free(); throw error; }
  return rows(args, scanner, first, positions, budget, writer);
}
async function* rows(args: Arguments, scanner: Scanner, first: RecordRow | undefined, positions: number[] | undefined, budget: Budget, writer: Writer): ByteSource {
  const expected = first?.width ?? 0;
  const ring: RecordRow[] = [];
  let ringCursor = 0;
  let current = first;
  const raw = args.command === "select" && (args.delimiter ?? inferDelimiter(args.inputs[0]!)) === 44 && writer.delimiter === 44;
  try {
    if (!args.noHeaders) {
      yield* emitted(await writer.row(first?.cells ?? [], positions), budget);
      first?.free(); current = undefined;
    }
    if (args.last === 0) return;
    if (!first) return;
    let index = 0n;
    let wanted = 0;
    while (true) {
      current ??= await scanner.next();
      if (!current) break;
      width(current, expected, args.command);
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
  let start = 0;
  let end = text.length;
  while (start < end && whitespace(text.charCodeAt(start))) { budget.work(); start++; }
  while (end > start && whitespace(text.charCodeAt(end - 1))) { budget.work(); end--; }
  let result = "";
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    let part: string;
    if (offset < start || offset >= end) part = "·".repeat(code < 128 ? 1 : code < 2048 ? 2 : 3);
    else if (code === 173 || (code < 32 && !whitespace(code))) part = "";
    else if (code === 10) part = "\\n";
    else if (code === 13) part = "\\r";
    else if (code === 9) part = "\\t";
    else if (code === 12) part = "\\f";
    else part = text[offset]!;
    budget.hold(part.length * 2); budget.work(part.length); result += part;
    if ((offset & 1023) === 0) await budget.checkpoint();
  }
  return result;
}
interface Header { row?: RecordRow; names: string[]; display: string[] }
async function prepareHeaders(args: Arguments, scope: InputScope, budget: Budget, writer: Writer): Promise<ByteSource> {
  const headers: Header[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    for (const path of args.inputs) {
      const scanner = scope.open(path, args);
      const row = await scanner.next();
      const header: Header = { ...(row ? { row } : {}), names: [], display: [] };
      budget.hold(32); headers.push(header);
      for (let index = 0; index < (row?.cells.length ?? 0); index++) {
        const bytes = row!.cells[index]!.decoded.view();
        budget.hold(bytes.length * 2 + 32); budget.work(bytes.length); await budget.checkpoint();
        let name: string;
        try { name = decoder.decode(bytes); }
        catch { throw new XanError(`CSV header UTF-8 error: field ${index}, record 1 (byte: ${row!.offset})`); }
        budget.release(bytes.length * 2 - name.length * 2);
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
    const width = Math.max(4, String(Math.max(0, maximum - 1)).length);
    const counts = new Map<string, { count: number; bytes: Uint8Array; display: string }>();
    for (let file = 0; file < headers.length; file++) {
      const header = headers[file]!;
      if (headers.length > 1) yield* emitted(await writer.text(`${file ? "\n" : ""}${args.inputs[file] === "-" ? "<stdin>" : args.inputs[file]}\n`), budget);
      for (let index = 0; index < header.names.length; index++) {
        const name = header.names[index]!;
        if (headers.length > 1) {
          const previous = counts.get(name);
          if (previous) previous.count++;
          else { budget.hold(32); counts.set(name, { count: 1, bytes: header.row!.cells[index]!.decoded.view(), display: header.display[index]! }); }
        }
        const prefix = args.justNames ? "" : checkedAdd(args.start, BigInt(index)).toString().padEnd(width, " ");
        yield* emitted(await writer.text(`${prefix}${header.display[index]}\n`), budget);
      }
    }
    if (headers.length > 1) {
      const same = [...counts.values()].every(value => value.count === headers.length);
      if (same) yield* emitted(await writer.text("\nAll files have the same headers!\n"), budget);
      else {
        budget.hold(counts.size * 32);
        const divergent = [...counts.values()].filter(value => value.count < headers.length);
        divergent.sort((left, right) => {
          for (let offset = 0; offset < Math.min(left.bytes.length, right.bytes.length); offset++) { budget.work(); const difference = left.bytes[offset]! - right.bytes[offset]!; if (difference) return difference; }
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
