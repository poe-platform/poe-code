import { SsconvertError, type CapabilityContext, type Diagnostic } from "../contracts.js";
import type { Workbook, CellValue } from "../workbook.js";
import type { FormulaNode, ReferenceEndpoint } from "../formulas/ast.js";
import { parseExpression } from "../formulas/parser.js";
import { biffFunctions } from "./biff-source.js";
import { biffString, biffError } from "./biff-write.js";
import { words } from "./biff-write-binary.js";
import { foldSheetName } from "../workbook/case-fold.js";

const operators: Readonly<Record<string, number>> = { "+": 3, "-": 4, "*": 5, "/": 6, "^": 7, "&": 8,
  "<": 9, "<=": 10, "=": 11, ">=": 12, ">": 13, "<>": 14, " ": 15, ",": 16, ":": 17 };
const functions = new Map(Object.entries(biffFunctions).map(([id, spec]) => [spec[0], { id: Number(id), min: spec[1], max: spec[2] }]));
// Gnumeric 1.12.61 ms-excel-read.c excel97_func_desc: these must be macros, not addins.
const macroFunctions = new Set(["AVERAGEIF", "AVERAGEIFS", "CUBEKPIMEMBER", "CUBEMEMBER", "CUBEMEMBERPROPERTY",
  "CUBERANKEDMEMBER", "CUBESET", "CUBESETCOUNT", "CUBEVALUE", "COUNTIFS", "IFERROR", "SUMIFS"]);

export interface CompiledBiffFormula { readonly tokens: Uint8Array; readonly arrays: Uint8Array; readonly diagnostics: readonly Diagnostic[]; }

export class BiffFormulaWriter {
  readonly externalSheets: { first: number; last: number }[] = [];
  readonly externNames: string[] = [];
  readonly macroNames: string[] = [];
  private uniqueNameId = 0;
  private readonly relocations: { tokens: Uint8Array; offset: number; index: number; kind: "sheet" | "macro" }[] = [];
  constructor(readonly book: Workbook, readonly revision: 7 | 8, readonly context: CapabilityContext) {}
  /** Resolve indices only after all cell, array and defined-name expressions are compiled. */
  finalize(): void {
    for (const relocation of this.relocations) {
      this.context.signal.throwIfAborted();
      const index = relocation.kind === "sheet" ? relocation.index + Number(this.externNames.length > 0) :
        (this.book.names?.length ?? 0) + relocation.index + 1;
      new DataView(relocation.tokens.buffer, relocation.tokens.byteOffset).setUint16(relocation.offset, index, true);
    }
  }
  compile(source: string, sheet: string, row: number, column: number, relative = false): CompiledBiffFormula {
    const parsed = parseExpression(source, { workbook: this.book, position: { sheet, row, column }, signal: this.context.signal,
      maximumNodes: this.context.limits.workbookNodes ?? this.context.limits.cells,
      maximumLength: this.context.limits.workbookTextBytes ?? this.context.limits.outputBytes });
    if (!parsed.ok) throw new SsconvertError("unsupported-feature", `Cannot export Excel formula: ${source}`);
    const bytes: number[] = [], arrays: number[] = [], diagnostics: Diagnostic[] = [];
    const relocations: { offset: number; index: number; kind: "sheet" | "macro" }[] = [];
    const push = (part: Uint8Array | readonly number[], target = bytes): void => {
      if (part.length > this.context.limits.outputBytes - bytes.length - arrays.length)
        throw new SsconvertError("resource-limit", "ssconvert BIFF formula bytes limit exceeded");
      for (const byte of part) target.push(byte);
    };
    const reference = (endpoint: ReferenceEndpoint): Uint8Array => {
      const r = endpoint.row!, c = endpoint.column!;
      const actualRow = r.value + (r.relative ? row : 0), actualColumn = c.value + (c.relative ? column : 0);
      if (actualRow < 0 || actualRow >= (this.revision === 8 ? 65536 : 16384) || actualColumn < 0 || actualColumn >= 256)
        throw new SsconvertError("unsupported-feature", "Excel BIFF formula reference exceeds version limits");
      const rowBits = relative && r.relative ? r.value : actualRow, colBits = relative && c.relative ? c.value : actualColumn;
      return this.revision === 8 ? words(rowBits, (colBits & 255) | (r.relative ? 0x8000 : 0) | (c.relative ? 0x4000 : 0)) :
        new Uint8Array([rowBits & 255, (rowBits >> 8 & 63) | (r.relative ? 128 : 0) | (c.relative ? 64 : 0), colBits & 255]);
    };
    const literal = (value: CellValue): void => {
      if (value.kind === "number") {
        if (value.value >= 0 && value.value <= 65535 && Number.isInteger(value.value)) push([30, ...words(value.value)]);
        else { const data = new Uint8Array(9); data[0] = 31; new DataView(data.buffer).setFloat64(1, value.value, true); push(data); }
      } else if (value.kind === "boolean") push([29, Number(value.value)]);
      else if (value.kind === "error") push([28, biffError(value.value)]);
      else if (value.kind === "blank") push([22]);
      else {
        const chunks: string[] = []; let chunk = "";
        for (const character of value.value) { if (chunk.length + character.length > 255) { chunks.push(chunk); chunk = ""; } chunk += character; }
        chunks.push(chunk);
        chunks.forEach((text, index) => { push([23]); push(biffString(text, this.revision, this.context, 1)); if (index) push([8]); });
        if (chunks.length > 1) push([21]);
      }
    };
    const visit = (node: FormulaNode): void => {
      this.context.signal.throwIfAborted();
      if (node.kind === "literal") literal(node.value);
      else if (node.kind === "omitted") push([22]);
      else if (node.kind === "parentheses") { visit(node.child); push([21]); }
      else if (node.kind === "unary") { visit(node.child); push([node.op === "+" ? 18 : node.op === "-" ? 19 : 20]); }
      else if (node.kind === "binary") {
        const opcode = operators[node.op]; if (opcode === undefined) throw new SsconvertError("unsupported-feature", `Unsupported Excel operator '${node.op}'`);
        visit(node.left); visit(node.right); push([opcode]);
      } else if (node.kind === "reference") {
        if (node.first.workbook || node.last?.workbook) throw new SsconvertError("unsupported-feature", "Excel BIFF external workbook formula is not implemented");
        const endpoint = (ref: ReferenceEndpoint, end: boolean): ReferenceEndpoint => ({ ...ref,
          row: ref.row ?? { value: end ? this.revision === 8 ? 65535 : 16383 : 0, relative: false },
          column: ref.column ?? { value: end ? 255 : 0, relative: false } });
        const first = reference(endpoint(node.first, false)), last = node.last ? reference(endpoint(node.last, true)) : undefined;
        const qualified = node.first.sheet !== undefined;
        let index = 0, firstSheet = 0, lastSheet = 0;
        if (qualified) {
          firstSheet = this.book.sheets.findIndex(s => foldSheetName(s.name) === foldSheetName(node.first.sheet!));
          lastSheet = node.last?.sheet !== undefined ? this.book.sheets.findIndex(s => foldSheetName(s.name) === foldSheetName(node.last!.sheet!)) : firstSheet;
          if (firstSheet < 0 || lastSheet < 0) throw new SsconvertError("unsupported-feature", "Excel BIFF detached sheet formula is not implemented");
          index = this.externalSheets.findIndex(s => s.first === firstSheet && s.last === lastSheet);
          if (index < 0) { index = this.externalSheets.length; this.externalSheets.push({ first: firstSheet, last: lastSheet }); }
        }
        push([qualified ? last ? 0x5b : 0x5a : last ? relative ? 0x4d : 0x45 : relative ? 0x4c : 0x44]);
        if (qualified) {
          if (this.revision === 8) { relocations.push({ offset: bytes.length, index, kind: "sheet" }); push(words(index)); }
          else { const prefix = new Uint8Array(14), view = new DataView(prefix.buffer);
            view.setInt16(0, -(firstSheet + 1), true); view.setUint16(10, firstSheet, true); view.setUint16(12, lastSheet, true); push(prefix); }
        }
        if (last) { push(first.subarray(0, 2)); push(last.subarray(0, 2)); push(first.subarray(2)); push(last.subarray(2)); }
        else push(first);
      } else if (node.kind === "name") {
        const current = this.book.sheets.find(s => s.id === sheet) ??
          this.book.sheets.find(s => foldSheetName(s.name) === foldSheetName(sheet));
        const scope = node.sheet === undefined ? current :
          this.book.sheets.find(s => foldSheetName(s.name) === foldSheetName(node.sheet!));
        const matches = (name: { readonly name: string }): boolean => name.name === node.name;
        let index = node.workbook === "" && node.sheet === undefined ? -1 : this.book.names?.findIndex(n => matches(n) && n.sheet !== undefined && scope !== undefined &&
          n.sheet === scope.id) ?? -1;
        if (index < 0 && (node.sheet === undefined || scope !== undefined))
          index = this.book.names?.findIndex(n => matches(n) && n.sheet === undefined) ?? -1;
        if (index < 0 || node.workbook) { push([28, 29]); return; }
        if (node.sheet !== undefined && scope !== undefined) {
          const data = new Uint8Array(this.revision === 8 ? 7 : 25), view = new DataView(data.buffer);
          data[0] = 0x59;
          const scopeIndex = this.book.sheets.indexOf(scope);
          if (this.revision === 8) {
            let externalIndex = this.externalSheets.findIndex(s => s.first === scopeIndex && s.last === scopeIndex);
            if (externalIndex < 0) { externalIndex = this.externalSheets.length; this.externalSheets.push({ first: scopeIndex, last: scopeIndex }); }
            relocations.push({ offset: bytes.length + 1, index: externalIndex, kind: "sheet" });
            view.setUint16(1, externalIndex, true); view.setUint16(3, index + 1, true);
          } else {
            const externalIndex = current === scope ? this.book.sheets.length + 1 : scopeIndex;
            view.setInt16(1, -(externalIndex + 1), true); view.setUint16(9, 1, true);
            view.setUint16(11, index + 1, true); view.setUint16(19, 15, true); view.setUint32(21, ++this.uniqueNameId, true);
          }
          push(data);
        } else {
          const data = new Uint8Array(this.revision === 8 ? 5 : 15); data[0] = 0x43;
          new DataView(data.buffer).setUint16(1, index + 1, true); push(data);
        }
      } else if (node.kind === "call") {
        const name = node.name.toUpperCase(), known = functions.get(name);
        const macro = macroFunctions.has(name), external = !known || known.id === 255;
        const spec = macro && name === "IFERROR" ? { id: 255, min: 2, max: 2 } : external ?
          { id: 255, min: node.args.length, max: node.args.length } : known!;
        if (external || macro) {
          const data = new Uint8Array(macro ? this.revision === 8 ? 5 : 15 : this.revision === 8 ? 7 : 25);
          const view = new DataView(data.buffer);
          if (macro) {
            const macroName = `_xlfn.${name}`;
            let index = this.macroNames.indexOf(macroName);
            if (index < 0) { index = this.macroNames.length; this.macroNames.push(macroName); }
            data[0] = 0x23; relocations.push({ offset: bytes.length + 1, index, kind: "macro" });
            view.setUint16(1, (this.book.names?.length ?? 0) + index + 1, true);
          } else {
            let index = this.externNames.indexOf(name);
            if (index < 0) { index = this.externNames.length; this.externNames.push(name); }
            data[0] = 0x39;
            view.setUint16(1, this.revision === 8 ? 0 : this.book.sheets.length + 1, true);
            view.setUint16(this.revision === 8 ? 3 : 11, index + 1, true);
          }
          push(data);
        }
        const count = Math.min(node.args.length, spec.max);
        if (node.args.length > spec.max) diagnostics.push({ code: "biff-loss-warning", severity: "warning",
          message: `Too many arguments for function '${node.name}', MS Excel can only handle ${spec.max} not ${node.args.length}` });
        for (const arg of node.args.slice(0, count)) visit(arg);
        for (let i = count; i < spec.min; i++) push([22]);
        if (external || macro) push([0x42, Math.max(count, spec.min) + 1, ...words(255)]);
        else if (spec.min === spec.max) push([0x41, ...words(spec.id)]);
        else push([0x42, Math.max(count, spec.min), ...words(spec.id)]);
      } else {
        const columns = node.rows[0]?.length ?? 0;
        if (!columns || columns > 256 || node.rows.length > 65536) throw new SsconvertError("unsupported-feature", "Excel BIFF array dimensions exceed limits");
        push([0x40, ...new Uint8Array(7)]);
        push([this.revision === 8 ? columns - 1 : columns & 255, ...words(node.rows.length - (this.revision === 8 ? 1 : 0))], arrays);
        for (const arrayRow of node.rows) for (const item of arrayRow) {
          if (item.kind !== "literal") throw new SsconvertError("unsupported-feature", "Excel BIFF array requires literals");
          const value = item.value;
          if (value.kind === "string") { push([2], arrays); push(biffString(value.value, this.revision, this.context, this.revision === 8 ? 2 : 1), arrays); }
          else { const data = new Uint8Array(9), view = new DataView(data.buffer);
            data[0] = value.kind === "number" ? 1 : value.kind === "boolean" ? 4 : value.kind === "error" ? 16 : 0;
            if (value.kind === "number") view.setFloat64(1, value.value, true);
            else if (value.kind === "boolean") data[1] = Number(value.value);
            else if (value.kind === "error") data[1] = biffError(value.value); push(data, arrays); }
        }
      }
    };
    visit(parsed.document.root);
    const tokens = new Uint8Array(bytes);
    for (const relocation of relocations) this.relocations.push({ ...relocation, tokens });
    return { tokens, arrays: new Uint8Array(arrays), diagnostics };
  }
}
