// Released Gnumeric 1.12.61 plugins/lotus-123; GPL-2.0-or-later.
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { formatA1, type Cell, type CellValue, type Workbook, type AxisMetadata, type ImportedValue, type UnsupportedRecord } from "../workbook.js";
import { lotusColors } from "./lotus-colors.js";
import { LotusRldb } from "./lotus-rldb.js";
import { Binary } from "./biff-binary.js";
import { lmbcsGroups } from "./lotus-charset.js";
import { readLotusWorks } from "./lotus-works.js";
import { worksFunctions } from "./lotus-works-functions.js";
import { lotusFunctions, lotusFunctionsByName } from "./lotus-functions.js";
import { gnumericGrammar } from "../formulas/conventions.js";
import { quoteFormulaString } from "../formulas/serialization.js";
import { biffDbcsTables } from "../encoding/biff-dbcs-tables.js";

export function probeLotus(bytes: Uint8Array, context: CapabilityContext): boolean {
  context.signal.throwIfAborted();
  if (bytes.length < 6) return false;
  const b = new Binary(bytes), length = b.u16(2), version = b.u16(4);
  return (b.u16(0) === 0 || b.u16(0) === 0xff) &&
    ([0x404, 0x405, 0x406].includes(version) ? length === 2 : [0x1002, 0x1003, 0x1004, 0x1005].includes(version) && length >= 19);
}
async function lmbcs(bytes: Uint8Array, group: number, context: CapabilityContext): Promise<string> {
  let text = "";
  const warn = async (message: string) => context.diagnostic?.({ code: "lotus", severity: "warning", message });
  const mapped = (g: number, c: number) => lmbcsGroups[g]?.[c - ([3, 4, 5, 8, 11].includes(g) ? 128 : 0)] ?? 0;
  for (let at = 0; at < bytes.length;) {
    context.signal.throwIfAborted();
    const c = bytes[at++]!;
    if (!c) break;
    if ([1, 2, 3, 4, 5, 6, 8, 11, 15].includes(c)) {
      if (at >= bytes.length) break;
      const uc = mapped(c, bytes[at++]!); if (uc) text += String.fromCodePoint(uc);
    } else if (c === 0x14) {
      if (at + 1 >= bytes.length) break;
      const uc = bytes[at++]! * 256 + bytes[at++]!;
      if (uc >= 0xe000 && uc <= 0xf8ff) await warn(`Unhandled character 0x14${uc.toString(16).padStart(4, "0")}`);
      else text += String.fromCodePoint(uc);
    } else if (c === 0x12 || c >= 128 && group === 0x12) {
      const start = c === 0x12 ? at : at - 1;
      if (start + 1 >= bytes.length) break;
      const lead = bytes[start]!, trail = bytes[start + 1]!;
      at = start + 2;
      if (lead > 0x80 && lead !== 0xff && trail) {
        const character = biffDbcsTables[950]?.double[lead]?.[trail];
        if (character !== undefined && character !== "\uffff") text += character;
      }
    } else if ([7, 12, 14].includes(c)) {
      if (at >= bytes.length) break;
      await warn(`Unhandled character 0x${(c * 256 + bytes[at++]!).toString(16).padStart(4, "0")}`);
    } else if ([16, 17, 19, 21, 22, 23].includes(c)) {
      if (at + 1 >= bytes.length) break;
      await warn(`Unhandled character 0x${(c * 65536 + bytes[at++]! * 256 + bytes[at++]!).toString(16).padStart(6, "0")}`);
    } else if (c >= 24 && c <= 31) at++;
    else if (c < 128) text += String.fromCharCode(c);
    else if (lmbcsGroups[group]) { const uc = mapped(group, c); if (uc) text += String.fromCodePoint(uc); }
    else await warn(`Unhandled character set 0x${group.toString(16)}`);
  }
  return text;
}
function smallNumber(d: number): number {
  const factor = [5000, 500, -20, -200, -2000, -20000, -16, -64][d >> 1 & 7]!;
  return d & 1 ? factor > 0 ? factor * (d >> 4) : (d >> 4) / -factor : d >> 1;
}
function packedNumber(d: number): number { return (d >>> 6) * (d & 32 ? -1 : 1) * 10 ** ((d & 16 ? -1 : 1) * (d & 15)); }
function treal(b: Binary, at: number): CellValue {
  b.check(at, 10);
  if (b.u16(at + 8) === 65535) {
    const code = b.u8(at + 7);
    if (!code) return { kind: "blank" };
    if (code === 0xc0 || code === 0xd0) return { kind: "error", value: code === 0xc0 ? "#VALUE!" : "#N/A" };
    if (code === 0xe0) return { kind: "string", value: "" };
  }
  const exponent = b.u16(at + 8), mantissa = Number(BigInt(b.u32(at + 4)) * 0x100000000n + BigInt(b.u32(at)));
  return { kind: "number", value: (exponent & 32768 ? -1 : 1) * mantissa * 2 ** ((exponent & 32767) - 16383 - 63) };
}
async function lotusFormat(fmt: number, context: CapabilityContext): Promise<string> {
  const kind = fmt >> 4 & 7, precision = fmt & 15, decimals = precision ? "." + "0".repeat(precision) : "";
  if (kind === 0 || kind === 1 || kind === 3) return "0" + decimals + (kind === 1 ? "E+00" : kind === 3 ? "%" : "");
  if (kind === 2) return `$#,##0${decimals}_);[Red]($#,##0${decimals})`;
  if (kind === 4) return "#,##0" + decimals;
  if (kind === 7) return ["General", "General", "d-mmm-yy", "d-mmm", "mmm yy", "General", ";;;", "h:mm:ss AM/PM", "h:mm", "m/d/yy", "d/m/yy"][precision] ?? "General";
  await context.diagnostic?.({ code: "lotus", severity: "warning", message: kind === 6 ? "Country format used." : `Unknown format type ${kind} used.` });
  return "";
}

async function lotusFormula(bytes: Uint8Array, version: number, group: number, row: number, column: number,
  sheetIndex: number, sheetName: (index: number) => string, context: CapabilityContext,
  consumeOperation: () => void, functions: typeof lotusFunctions = lotusFunctions): Promise<string> {
  const b = new Binary(bytes), stack: string[] = [], modern = version >= 0x1002;
  let at = 0;
  const pop = async () => {
    if (stack.length) return stack.pop()!;
    await context.diagnostic?.({ code: "lotus", severity: "warning", message: `${formatA1(row, column)}: stack underflow` }); return "#REF!";
  };
  const ref = (r: number, c: number, rr: boolean, cr: boolean) => {
    if (r < 0 || c < 0) return "#REF!";
    const a = formatA1(r, c); let i = 0; while (a[i]! >= "A" && a[i]! <= "Z") i++;
    return (cr ? "" : "$") + a.slice(0, i) + (rr ? "" : "$") + a.slice(i);
  };
  const oldRef = (p: number) => {
    const c = b.u16(p), r = b.u16(p + 2), cr = !!(c & 32768), rr = !!(r & 32768);
    return ref((r & 4095) * (rr && r & 4096 ? -1 : 1) + (rr ? row : 0),
      (c & 4095) % 256 * (cr && c & 4096 ? -1 : 1) + (cr ? column : 0), rr, cr);
  };
  const newRef = (p: number, flags: number) => {
    const target = b.u8(p + 2), name = sheetName(target);
    return (target === sheetIndex ? "" : `'${name.split("'").join("''")}'!`) + ref(b.u16(p), b.u8(p + 3), !!(flags & 1), !!(flags & 2));
  };
  while (at < bytes.length) {
    context.signal.throwIfAborted();
    const op = b.u8(at++);
    if (op === 3) break;
    consumeOperation();
    if (op === 4) continue;
    if (op === 0) {
      const length = modern ? 10 : 8; if (at + length > bytes.length) break;
      const value = modern ? treal(b, at) : { kind: "number" as const, value: b.f64(at) };
      stack.push(value.kind === "number" ? String(value.value) : value.kind === "error" ? value.value : value.kind === "string" ? '""' : "0"); at += length;
    } else if (op === 1 || op === 2) {
      const length = modern ? op === 1 ? 5 : 9 : op === 1 ? 4 : 8;
      if (at + length > bytes.length) break;
      if (modern) {
        // Released parser reads data[1] for relative bits, including later references.
        const flags = bytes[1]!;
        stack.push(newRef(at + 1, flags & 7) + (op === 2 ? `:${newRef(at + 5, flags >> 3 & 7)}` : ""));
      } else stack.push(oldRef(at) + (op === 2 ? `:${oldRef(at + 4)}` : ""));
      at += length;
    } else if (op === 5) {
      const length = modern && version > 0x1002 ? 4 : 2;
      if (at + length > bytes.length) break;
      const n = b.u16(at), signed = n >= 32768 ? n - 65536 : n;
      stack.push(String(modern ? length === 4 ? packedNumber(b.u32(at)) : smallNumber(n) : signed)); at += length;
    } else if (op === 6) {
      const start = at; while (at < bytes.length && bytes[at]) at++;
      stack.push('"' + (await lmbcs(bytes.subarray(start, at), group, context)).split('"').join('""') + '"'); at++;
    } else if (modern && (op === 7 || op === 8)) {
      await context.diagnostic?.({ code: "lotus", severity: "warning", message: "Named ranges not implemented." });
    } else if (modern && op >= 9 && op <= 11) {
      const length = op === 9 ? 4 : op === 10 ? 5 : 11;
      if (at + length > bytes.length) break;
      stack.push(op === 11 ? "#VALUE!" : "#REF!"); at += length;
    } else if (op === (modern ? 14 : 8) || op === (modern ? 29 : 23) || op === (modern ? 28 : 22)) {
      const arg = await pop(); stack.push(op === (modern ? 28 : 22) ? `NOT(${arg})` : `${op === (modern ? 14 : 8) ? "-" : "+"}(${arg})`);
    } else if (op >= (modern ? 15 : 9) && op <= (modern ? 27 : 21) || op === (modern ? 30 : 24)) {
      const right = await pop(), left = await pop(), base = modern ? 15 : 9;
      const operators = ["+", "-", "*", "/", "^", "=", "<>", "<=", ">=", "<", ">"];
      stack.push(op === base + 11 || op === base + 12 ? `${op === base + 11 ? "AND" : "OR"}(${left},${right})` : `(${left}${op === (modern ? 30 : 24) ? "&" : operators[op - base]}${right})`);
    } else {
      let info = functions[op], args = info?.[0] ?? 0, name = info?.[2] ?? `LOTUS_${info?.[1] ?? ""}`;
      if (modern && op === 0x7a) {
        if (at + 3 > bytes.length) break;
        args = b.u8(at++); const length = b.u16(at); at += 2; if (at + length > bytes.length) break;
        let raw = await lmbcs(bytes.subarray(at, at + length), group, context); at += length;
        if (raw.endsWith("(")) raw = raw.slice(0, -1);
        let i = raw.length; while (i && ((raw[i - 1]! >= "a" && raw[i - 1]! <= "z") || (raw[i - 1]! >= "A" && raw[i - 1]! <= "Z") || (raw[i - 1]! >= "0" && raw[i - 1]! <= "9"))) i--;
        raw = raw.slice(i); info = lotusFunctionsByName[raw];
        name = info?.[2] ?? `LOTUS_${raw}`;
      } else {
        if (functions === lotusFunctions && op >= 166) await context.diagnostic?.({ code: "lotus", severity: "warning", message: `Encountered lotus opcode ${op}\n` });
        if (!info) { await context.diagnostic?.({ code: "lotus", severity: "warning", message: `${formatA1(row, column)}: unknown PTG 0x${op.toString(16)}` }); continue; }
        if (args < 0) { if (at >= bytes.length) break; args = b.u8(at++); }
      }
      const operands: string[] = []; for (let i = 0; i < args; i++) operands.unshift(await pop());
      if ([0x38, 0x39, 0x3a].includes(op)) operands.push(`-(${operands.shift()!})`);
      if (op === 0x59) operands.reverse();
      stack.push(`${name}(${operands.join(",")})`);
    }
    if (stack.reduce((n, s) => n + s.length, 0) > context.limits.inputBytes)
      throw new SsconvertError("resource-limit", "ssconvert Lotus formula length limit exceeded");
  }
  const result = stack.pop() ?? "#VALUE!";
  if (stack.length) await context.diagnostic?.({ code: "lotus", severity: "warning", message: `${formatA1(row, column)}: args remain on stack` });
  return `=${result}`;
}

export async function readLotus(bytes: Uint8Array, context: CapabilityContext): Promise<Workbook> {
  context.signal.throwIfAborted();
  if (bytes.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert input bytes limit exceeded");
  const b = new Binary(new Uint8Array(bytes));
  if (bytes.length >= 6 && b.u16(0) === 255 && b.u16(4) === 0x404) return readLotusWorks(b.bytes, context,
    (tokens, row, column, index, name, tick) => lotusFormula(tokens, 0x404, 1, row, column, index, name, context, tick, worksFunctions),
    text => lmbcs(text, 1, context));
  if (bytes.length < 6 || b.u16(0) !== 0 || b.u16(2) < 2) throw new SsconvertError("io", "Error while reading lotus workbook.");
  const version = b.u16(4), modern = ![0x404, 0x405, 0x406].includes(version);
  if (![0x404, 0x405, 0x406, 0x1002, 0x1003, 0x1004, 0x1005].includes(version))
    await context.diagnostic?.({ code: "lotus", severity: "warning", message: `Unexpected version ${version.toString(16)}` });
  context.signal.throwIfAborted();
  let at = 0, group = 1, active = -1, nameIndex = 0, count = 0, outside = false, work = 0;
  const consumeOperation = () => {
    context.signal.throwIfAborted();
    if (++work > context.limits.operations)
      throw new SsconvertError("resource-limit", "ssconvert Lotus operations limit exceeded");
  };
  let database: LotusRldb | undefined, databaseType = 0;
  const styles = new Map<number, Record<string, ImportedValue>>();
  const names = new Map<string, { first: { row: number; column: number; sheet: number }; last: { row: number; column: number; sheet: number } }>();
  const sheets: { id: string; name: string; cells: Map<string, Cell>; columns: Map<number, AxisMetadata>; rows: Map<number, AxisMetadata>; defaultColumnWidth?: number; view: Record<string, ImportedValue>; metadata: UnsupportedRecord[]; formats: Map<string, string> }[] = [];
  const sheet = (index: number) => {
    if (index >= context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert Lotus sheets limit exceeded");
    while (sheets.length <= index) {
      const n = sheets.length; sheets.push({ id: `lotus-${n}`, name: modern ? `Sheet${n + 1}` : formatA1(0, n).slice(0, -1), cells: new Map(), columns: new Map(), rows: new Map(), view: {}, metadata: [], formats: new Map() });
    }
    return sheets[index]!;
  };
  const warn = async (message: string) => context.diagnostic?.({ code: "lotus", severity: "warning", message });
  while (at + 4 <= bytes.length) {
    context.signal.throwIfAborted();
    const id = b.u16(at); let length = b.u16(at + 2); at += 4;
    if (at + length > bytes.length) { await warn("Truncated record.  File is probably corrupted.\n"); length = 0; }
    const data = new Binary(b.slice(at, length)); at += length;
    if (id === 0) {
      if (modern) { if (length >= 18) group = data.u8(16); } else { active = sheets.length; sheet(active); }
      continue;
    }
    if (id === 1) { if (modern) break; active = -1; continue; }
    if (id === (modern ? 9 : 11)) {
      consumeOperation();
      if (length < (modern ? 26 : 24)) { await warn(`Record with type 0x${id.toString(16)} has wrong length ${length}.`); continue; }
      const type = modern ? data.u16(0) : 0;
      if (type > 1) {
        sheet(0).metadata.push({ source: "lotus", kind: "NamedRange", disposition: "retained", data: {
          type, payload: Array.from(data.bytes, byte => byte.toString(16).padStart(2, "0")).join("")
        } });
        await warn(`Ignoring unqualified Lotus named range type ${type}.`); continue;
      }
      const name = await lmbcs(data.bytes.subarray(modern ? 2 : 0, modern ? 18 : 16), group, context);
      if (!name) { await warn("Ignoring empty Lotus name."); continue; }
      const first = modern ? { row: data.u16(18), sheet: data.u8(20), column: data.u8(21) } : { row: data.u16(18), column: data.u16(16), sheet: active };
      const last = modern ? { row: data.u16(22), sheet: data.u8(24), column: data.u8(25) } : { row: data.u16(22), column: data.u16(20), sheet: active };
      if (first.column >= 256 || last.column >= 256 || first.sheet < 0 || last.sheet < 0) {
        await warn(`Ignoring invalid Lotus named range '${name}'.`); continue;
      }
      if (names.has(name)) { await warn(`Ignoring duplicate Lotus name '${name}'.`); continue; }
      sheet(first.sheet); sheet(last.sheet);
      names.set(name, { first, last }); continue;
    }
    if (modern && id >= 0x800 && id <= 0x804) {
      const runSize = version >= 0x1005 ? 4 : 2;
      const readRun = (offset: number) => runSize === 4 ? data.u32(offset) : data.u16(offset);
      const valid = id === 0x804 ? length >= 4 + runSize : id === 0x800 ? length >= runSize : id === 0x802 || id === 0x803 ? length === 2 : true;
      if (!valid) await warn(`Record with type 0x${id.toString(16)} has wrong length ${length}.`);
      else if (id === 0x804) {
        if (database) await warn(database.root.remaining ? "Unfinished rldb." : "Unused rldb.");
        database = undefined;
        const dimensions = data.u16(2);
        if (length !== 4 + runSize * dimensions) await warn(`Record with type 0x804 has wrong length ${length}.`);
        else if (dimensions < 1 || dimensions > 3) await warn(`Ignoring ${dimensions}d rldb.`);
        else database = new LotusRldb(Array.from({ length: dimensions }, (_, i) => readRun(4 + runSize * (dimensions - 1 - i))), consumeOperation);
      } else if (!database) await warn(`Ignoring stray ${id === 0x800 ? "RLDB_NODE" : id === 0x801 ? "RLDB_DATANODE" : id === 0x802 ? "RLDB_REGISTERID" : "RLDB_USEID"}`);
      else if (id === 0x800) await database.repeat(readRun(0), warn);
      else if (id === 0x801) database.data(data.bytes);
      else if (id === 0x802) database.register(data.u16(0));
      else database.use(data.u16(0));
      continue;
    }
    if (modern && [0x284, 0x293, 0x294, 0x295, 0x296].includes(id)) {
      if (!databaseType) databaseType = id;
      else if (!database || databaseType !== id) await warn("Unordered style info.");
      else {
        if (database.root.remaining) throw new SsconvertError("io", "Error while reading lotus workbook.");
        
        const axis = id === 0x295 || id === 0x296, dimensions = axis ? 2 : 3;
        if (database.root.dimensions !== dimensions) throw new SsconvertError("io", "Error while reading lotus workbook.");
        let sheetIndex = 0;
        for (const sheetRun of database.root.children) {
          for (let repeat = 0; repeat < sheetRun.repeat && sheetIndex < sheets.length; repeat++, sheetIndex++) {
            const s = sheets[sheetIndex]!; let start = 0;
            for (const columnRun of sheetRun.children) {
              if (start > (axis && id === 0x296 ? 65535 : 255)) break;
              const end = Math.min(axis && id === 0x296 ? 65535 : 255, start + columnRun.repeat - 1);
              if (axis) {
                const payload = columnRun.data;
                if (payload?.length) {
                  if (payload.length < 8) throw new SsconvertError("io", "Error while reading lotus workbook.");
                  const value = new Binary(payload), flags = value.u16(2), raw = value.u32(4);
                  const sizePoints = version >= 0x1005 ? (raw * 100 + 880) / 1740 : (raw * 100 + 11264) / 22272;
                  const values = id === 0x295 ? s.columns : s.rows;
                  for (let index = start; index <= end; index++) { consumeOperation(); const old = values.get(index);
                    values.set(index, { ...old, index, sizePoints, ...(flags & 2 ? { hidden: true } : {}) }); }
                }
              } else {
                let row = 0;
                for (const rowRun of columnRun.children) {
                  if (row > 65535) break;
                  const endRow = Math.min(65535, row + rowRun.repeat - 1), payload = rowRun.data;
                  if (payload?.length && id !== 0x294) {
                    const value = new Binary(payload);
                    if (id === 0x284 ? payload.length !== 2 : payload.length < 4) throw new SsconvertError("io", "Error while reading lotus workbook.");
                    const word = id === 0x284 ? 0 : value.u32(0);
                    let style: Record<string, ImportedValue> | undefined;
                    if (id === 0x284 || word & 0x800) {
                      if (id !== 0x284 && payload.length < 6) throw new SsconvertError("io", "Error while reading lotus workbook.");
                      style = styles.get(value.u16(id === 0x284 ? 0 : 4));
                      if (!style) throw new SsconvertError("io", "Error while reading lotus workbook.");
                    }
                    const format = id === 0x284 ? undefined : await lotusFormat(word, context);
                    for (const [key, cell] of s.cells) { consumeOperation(); if (cell.column >= start && cell.column <= end && cell.row >= row && cell.row <= endRow) {
                      if (format !== undefined) s.formats.set(key, format);
                      if (style) s.cells.set(key, { ...cell, style: { ...cell.style, ...style } });
                    } }
                    s.metadata.push({ source: "lotus", kind: id === 0x284 ? "StyleRange" : "FormatRange", disposition: "retained", data: { startRow: row, endRow, startColumn: start, endColumn: end, ...(format !== undefined ? { format } : {}), ...(style ? { style } : {}) } });
                  }
                  row = endRow + 1;
                }
              }
              start = end + 1;
            }
          }
        }
        database = undefined; databaseType = 0;
      }
      continue;
    }
    if (modern && id === 5) {
      if (length !== 16) await warn(`Record with type 0x5 has wrong length ${length}.`);
      else {
        consumeOperation();
        const s = sheet(data.u8(0));
        s.view.selection = formatA1(data.u16(4), data.u8(6));
        s.view.initialTopLeft = formatA1(data.u16(8), data.u8(7));
      }
      continue;
    }
    if (modern && id === 0x26) {
      if (length < 6) await warn(`Record with type 0x26 has wrong length ${length}.`);
      else {
        consumeOperation();
        sheet(data.u8(2)).metadata.push({ source: "lotus", kind: "CellComment", disposition: "retained",
          data: { ObjectBound: formatA1(data.u16(0), data.u8(3)), Text: await lmbcs(data.bytes.subarray(5), group, context) } });
      }
      continue;
    }
    if (modern && id === 0x13) {
      if (length < 2) await warn(`Record with type 0x13 has wrong length ${length}.`);
      else {
        const s = sheet(data.u8(0)), subtype = data.u8(1);
        if (subtype === 0 && length >= 4) {
          const row = data.u16(2); let column = 0;
          for (let offset = 4; offset + 4 <= length; offset += 4) {
            const word = data.u32(offset), repeat = !!(word & 0x80000000) && offset + 4 < length;
            const n = repeat ? 1 + data.u8(offset++ + 4) : 1;
            const format = await lotusFormat(word, context);
            for (let c = column; c < Math.min(256, column + n); c++) {
              consumeOperation();
              if (format) s.formats.set(`${row}:${c}`, format);
            }
            if (format) s.metadata.push({ source: "lotus", kind: "FormatRange", disposition: "retained", data: { startRow: row, endRow: row, startColumn: column, endColumn: Math.min(255, column + n - 1), format } });
            column += n;
          }
        } else if (subtype === 2 && length >= 8) {
          const row = data.u16(2), source = sheet(data.u16(4)), sourceRow = data.u16(6);
          const snapshot = source.metadata.slice();
          s.metadata.push({ source: "lotus", kind: "StyleRange", disposition: "retained", data: { startRow: row, endRow: row, startColumn: 0, endColumn: 255, style: {}, reset: true, format: "General" } });
          for (let c = 0; c < 256; c++) {
            consumeOperation();
            let format = source.formats.get(`${sourceRow}:${c}`) ?? "General";
            let style: Record<string, ImportedValue> = {};
            for (const record of snapshot) {
              consumeOperation();
              if (record.kind !== "StyleRange" && record.kind !== "FormatRange") continue;
              const range = record.data as Record<string, ImportedValue>;
              if (sourceRow < Number(range.startRow) || sourceRow > Number(range.endRow) || c < Number(range.startColumn) || c > Number(range.endColumn)) continue;
              if (range.reset) style = {};
              if (range.style) style = { ...style, ...range.style as Record<string, ImportedValue> };
              if (typeof range.format === "string") format = range.format;
            }
            s.formats.set(`${row}:${c}`, format);
            if (format !== "General") s.metadata.push({ source: "lotus", kind: "FormatRange", disposition: "retained", data: { startRow: row, endRow: row, startColumn: c, endColumn: c, format } });
            if (Object.keys(style).length) s.metadata.push({ source: "lotus", kind: "StyleRange", disposition: "retained", data: { startRow: row, endRow: row, startColumn: c, endColumn: c, style } });
            const cell = s.cells.get(`${row}:${c}`);
            if (cell) s.cells.set(`${row}:${c}`, { ...cell, style, format });
          }
        } else if (subtype === 0 || subtype === 2) await warn(`Record with type 0x13 has wrong length ${length}.`);
        else await warn(`Unknown format record 0x13/${subtype.toString(16).padStart(2, "0")} of length ${length}.\n`);
      }
      continue;
    }
    if (modern && id === 0x1b) {
      if (length < 2) await warn(`Record with type 0x1b has wrong length ${length}.`);
      else {
        const subtype = data.u16(0);
        if (subtype === 0x36b0) {
          if (length <= 5) await warn(`Record with type 0x1b has wrong length ${length}.`);
          else {
            consumeOperation();
            const nameBytes = data.bytes.subarray(4, length - 1), zero = nameBytes.indexOf(0);
            sheet(data.u8(2)).name = new TextDecoder().decode(zero < 0 ? nameBytes : nameBytes.subarray(0, zero));
          }
        } else if (subtype === 0xfa1) {
          if (length < 24) await warn(`Record with type 0x1b has wrong length ${length}.`);
        } else if (subtype === 0xfdc) {
          if (length < 11) await warn(`Record with type 0x1b has wrong length ${length}.`);
          else { consumeOperation(); styles.set(data.u16(2), { fontName: await lmbcs(data.bytes.subarray(10), group, context) }); }
        } else if (subtype === 0xfd2) {
          // Released parser checks >=24 but reads through byte28; bound those reads.
          if (length < 29) await warn(`Record with type 0x1b has wrong length ${length}.`);
          else {
            consumeOperation();
            const style: Record<string, ImportedValue> = {}, faces = data.u16(16), mask = data.u16(18);
            const color = async (id: number): Promise<string | undefined> => {
              if (id === 65535) return;
              if (id < lotusColors.length) return lotusColors[id];
              const labels = ["3D face", "highlight", "button shadow", "window background", "window text"];
              await warn(id >= 240 && id <= 244 ? `Unhandled "${labels[id - 240]}" color.` : `Unhandled color id ${id}.`);
              return;
            };
            const background = await color(data.u16(26)), foreground = await color(data.u16(24)), text = await color(data.u16(12));
            if (background) style.backgroundColor = background;
            if (foreground) style.patternColor = foreground;
            if (text) style.fontColor = text;
            const patternId = data.u8(28) === 255 && background ? 2 : data.u8(28);
            const patterns: Record<number, number> = { 0: 0, 2: 1, 8: 15, 26: 4, 27: 3, 51: 7, 55: 8 };
            if (patterns[patternId] !== undefined) style.pattern = patterns[patternId]!;
            else if (patternId !== 255) await warn(`Unhandled pattern ${patternId}.`);
            if (data.u16(10) !== 65535) style.fontSize = Math.floor(((data.u16(10) * 100 / 83 + 16) / 32) * 2 + 0.5) / 2;
            for (const [bit, name] of [[1, "bold"], [2, "italic"], [4, "underline"], [128, "strike"]] as const) if (mask & bit) style[name] = !!(faces & bit);
            styles.set(data.u16(2), style);
          }
        } else if (![0x07d7, 0x0fab, 0x0fb4, 0x0fc9, 0x0fe6, 0x0ff0, 0x0ffa, 0x32e7].includes(subtype))
          await warn(`Unknown style record 0x1b/${subtype.toString(16).padStart(4, "0")} of length ${length}.\n`);
      }
      continue;
    }
    if (modern && (id === 6 || id === 7)) {
      if (id === 6 ? length !== 5 : length < 4) {
        await warn(`Record with type 0x${id.toString(16)} has wrong length ${length}.`);
      } else {
        const s = sheet(data.u8(0));
        // Native performs integer division before converting twips to points.
        const width = (chars: number) => (chars * 130 * 100 + 880) / 1740;
        if (id === 6) { consumeOperation(); s.defaultColumnWidth = width(data.u8(4)); }
        else for (let i = 4; i + 1 < length; i += 2) {
          consumeOperation();
          const index = data.u8(i); s.columns.set(index, { index, sizePoints: width(data.u8(i + 1)) });
        }
      }
      continue;
    }
    if (modern && id === 0x204) {
      if (length < 11) await warn(`Record with type 0x204 has wrong length ${length}.`);
      else sheet(nameIndex++).name = await lmbcs(data.bytes.subarray(10), group, context);
      continue;
    }
    const minimums: Record<number, number> = modern ? { 20: 4, 21: 4, 22: 6, 23: 14, 24: 6, 25: 15, 26: 5, 37: 8, 39: 12, 40: 13 } : { 13: 7, 14: 13, 15: 7, 16: 15 };
    const minimum = minimums[id];
    if (minimum === undefined) {
      if (modern) {
        if (id === 0x10d) await warn('Unhandled "large data" record seen.');
        else if (![3, 9, 10, 11, 12, 0x1c, 0x1f, 0x23, 0x100, 0x103, 0x104, 0x105, 0x106, 0x107,
          0x109, 0x10a, 0x10b, 0x10c, 0x10e, 0x10f, 0x200, 0x201, 0x202, 0x205,
          0x280, 0x281, 0x282, 0x283, 0x285, 0x286, 0x287, 0x288, 0x292, 0x299, 0x29a,
          0x304, 0x400, 0x401, 0x640, 0x642, 0x643, 0x701, 0x702, 0x703, 0x704, 0x780, 0xa80, 0x2af6].includes(id))
          await warn(`Unknown record 0x${id.toString(16)} of length ${length}.`);
      }
      continue;
    }
    if (length < minimum || modern && id === 37 && length !== 8) { await warn(`Record with type 0x${id.toString(16)} has wrong length ${length}.`); continue; }
    const index = modern ? data.u8(2) : active;
    if (index < 0) continue;
    const s = sheet(index), row = modern ? data.u16(0) : data.u16(3), column = modern ? data.u8(3) : data.u16(1);
    const maxRows = modern ? 65536 : 65536;
    if (column >= 256 || row >= maxRows) {
      if (!outside) { outside = true; await warn("File is most likely corrupted.\n(It claims to contain a cell outside the range Gnumeric can handle.)"); }
      continue;
    }
    let value: CellValue = { kind: "blank" }, formula: string | undefined;
    if (!modern) {
      if (id === 13) { const n = data.u16(5); value = { kind: "number", value: n >= 32768 ? n - 65536 : n }; }
      if (id === 14 || id === 16) value = { kind: "number", value: data.f64(5) };
      if (id === 15) value = { kind: "string", value: await lmbcs(data.bytes.subarray(6), group, context) };
      if (id === 16) {
        const n = data.u16(13); if (15 + n > length) continue;
        formula = await lotusFormula(data.bytes.subarray(15, 15 + n), version, group, row, column, index, i => sheet(i).name, context, consumeOperation);
        if ((data.u16(11) & 0x7ff8) === 0x7ff0) {
          value = { kind: "error", value: "#VALUE!" };
          if (at + 4 <= bytes.length && b.u16(at) === 0x33) {
            const n = b.u16(at + 2); if (at + 4 + n <= bytes.length && n >= 5) value = { kind: "string", value: await lmbcs(b.slice(at + 9, n - 5), group, context) };
            at += n + 4;
          }
        }
      }
    } else {
      if (id === 20 || id === 21) value = { kind: "error", value: id === 20 ? "#VALUE!" : "#N/A" };
      if (id === 22 || id === 26) value = { kind: "string", value: await lmbcs(data.bytes.subarray(id === 22 ? 5 : 4), group, context) };
      if (id === 23 || id === 25) value = treal(data, 4);
      if (id === 24) { const n = data.u16(4); value = { kind: "number", value: smallNumber(n >= 32768 ? n - 65536 : n) }; }
      if (id === 37) value = { kind: "number", value: packedNumber(data.u32(4)) };
      if (id === 39 || id === 40) value = { kind: "number", value: data.f64(4) };
      if (id === 25 || id === 40) formula = await lotusFormula(data.bytes.subarray(id === 25 ? 14 : 12), version, group, row, column, index, i => sheet(i).name, context, consumeOperation);
    }
    const key = `${row}:${column}`, old = s.cells.get(key);
    if (!old && ++count > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert Lotus cells limit exceeded");
    let format = modern ? s.formats.get(key) : await lotusFormat(data.u8(0), context);
    let style = old?.style;
    if (modern) for (const record of s.metadata) {
      consumeOperation();
      if (record.kind !== "FormatRange" && record.kind !== "StyleRange") continue;
      const range = record.data as Record<string, ImportedValue>;
      if (row < Number(range.startRow) || row > Number(range.endRow) || column < Number(range.startColumn) || column > Number(range.endColumn)) continue;
      if (range.reset) style = {};
      if (typeof range.format === "string") format = range.format;
      if (range.style) style = { ...style, ...range.style as Record<string, ImportedValue> };
    }
    if (modern && format !== undefined) s.formats.set(key, format);
    s.cells.set(key, { row, column, value, ...(format ? { format } : {}), ...(style ? { style } : {}),
      ...(formula ? { formula, cachedResult: value, formulaDirty: false } : id === 26 && old?.formula ? { formula: old.formula, cachedResult: value, formulaDirty: false } : {}) });
  }
  if (database) await warn(database.root.remaining ? "Unfinished rldb." : "Unused rldb.");
  context.signal.throwIfAborted();
  if (!sheets.length) throw new SsconvertError("io", "Error while reading lotus workbook.");
  let nameTextBytes = 0;
  const chargeNameText = (text: string, escapeQuotes = false) => {
    for (const character of text) {
      context.signal.throwIfAborted();
      const point = character.codePointAt(0)!;
      nameTextBytes += (point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4) + (escapeQuotes && (character === "'" || character === "\\") ? 1 : 0);
      if (nameTextBytes > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
        throw new SsconvertError("resource-limit", "ssconvert Lotus named-expression text limit exceeded");
    }
  };
  const importedNames = [...names].map(([name, { first, last }]) => {
    consumeOperation(); chargeNameText(name); chargeNameText("=");
    const qualifier = (index: number) => {
      chargeNameText("''!"); chargeNameText(sheets[index]!.name, true);
      return quoteFormulaString(sheets[index]!.name, "'", gnumericGrammar) + "!";
    };
    const address = (row: number, column: number) => {
      const a1 = formatA1(row, column); let digits = 0;
      while (a1[digits]! >= "A" && a1[digits]! <= "Z") digits++;
      const result = "$" + a1.slice(0, digits) + "$" + a1.slice(digits);
      chargeNameText(result); return result;
    };
    const single = first.sheet === last.sheet && first.row === last.row && first.column === last.column;
    const firstQualifier = qualifier(first.sheet), firstAddress = address(first.row, first.column);
    let end = "";
    if (!single) {
      chargeNameText(":");
      const lastQualifier = first.sheet === last.sheet ? "" : qualifier(last.sheet), lastAddress = address(last.row, last.column);
      end = ":" + lastQualifier + lastAddress;
    }
    return { name, expression: "=" + firstQualifier + firstAddress + end };
  });
  return { sheets: sheets.map(s => ({ id: s.id, name: s.name, size: { rows: 65536, columns: 256 }, cells: [...s.cells.values()].map(cell => s.formats.has(`${cell.row}:${cell.column}`) ? { ...cell, format: s.formats.get(`${cell.row}:${cell.column}`)! } : cell).sort((a, b) => a.row - b.row || a.column - b.column),
    ...(s.rows.size ? { rows: [...s.rows.values()].sort((a, b) => a.index - b.index) } : {}),
    ...(s.columns.size ? { columns: [...s.columns.values()].sort((a, b) => a.index - b.index) } : {}),
    ...(Object.keys(s.view).length || s.defaultColumnWidth !== undefined ? { view: { ...s.view, ...(s.defaultColumnWidth !== undefined ? { defaultColumnWidth: s.defaultColumnWidth } : {}) } } : {}),
    ...(s.metadata.length ? { unsupportedRecords: s.metadata } : {}) })), activeSheet: sheets[0]!.id, ...(importedNames.length ? { names: importedNames } : {}) };
}
