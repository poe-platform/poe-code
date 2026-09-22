import { SsconvertError } from "../contracts.js";
import { gnumericGrammar } from "./conventions.js";
import { isUnicodeAlphanumeric } from "../cli/unicode-alphanumeric.js";
import { isUnicodeAlpha } from "../workbook/unicode-sheet-name.js";
import type { Axis, FormulaNode, FormulaParseOptions, FormulaParseResult, ReferenceEndpoint } from "./ast.js";

const digit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const letter = (c: string | undefined): boolean => c !== undefined && (c >= "A" && c <= "Z" || c >= "a" && c <= "z");
const word = (c: string | undefined): boolean => c !== undefined && (letter(c) || digit(c) || c === "_" || c === "." || c === "$" || c.charCodeAt(0) > 127 && !"¬∧∨".includes(c));
const whitespace = (c: string | undefined): boolean => c !== undefined && " \t\r\n".includes(c);

/** Relative axes are offsets from the explicit parse position, never the active cell. */
export function parseExpression(source: string, options: FormulaParseOptions): FormulaParseResult {
  const grammar = options.grammar ?? gnumericGrammar;
  options.signal?.throwIfAborted();
  if (source.length > (options.maximumLength ?? 1_048_576)) throw new SsconvertError("resource-limit", "ssconvert formula length limit exceeded");
  const position = options.position;
  const rangeSeparator = grammar.rangeSeparator ?? ":";
  for (const value of [position.row, position.column])
    if (!Number.isSafeInteger(value) || value < 0) throw new SsconvertError("invalid-request", "Invalid formula parse position");
  let offset = 0, depth = 0, nodes = 0;
  for (const prefix of grammar.prefixes) if (source.startsWith(prefix)) { offset = prefix.length; break; }
  const heights = new WeakMap<FormulaNode, number>();
  const syntax = {};
  let diagnostic = { code: "syntax" as const, message: "Invalid formula", start: offset, end: offset };
  function fail(message = "Invalid formula", start = offset, end = Math.min(source.length, offset + 1)): never {
    start = Math.min(source.length, Math.max(0, start));
    end = Math.min(source.length, Math.max(start, end));
    diagnostic = { code: "syntax", message, start, end }; throw syntax;
  }
  function node<T extends FormulaNode>(value: T): T {
    options.signal?.throwIfAborted();
    if (++nodes > (options.maximumNodes ?? 65_536)) throw new SsconvertError("resource-limit", "ssconvert formula node limit exceeded");
    const children = value.kind === "binary" ? [value.left, value.right] : value.kind === "unary" || value.kind === "parentheses" ? [value.child] :
      value.kind === "call" ? value.args : value.kind === "array" ? value.rows.flat() : [];
    let height = 1;
    for (const child of children) height = Math.max(height, 1 + (heights.get(child) ?? 1));
    if (height > 128) throw new SsconvertError("resource-limit", "ssconvert formula depth limit exceeded");
    heights.set(value, height); return value;
  }
  function space(): boolean {
    const start = offset;
    while (whitespace(source[offset])) offset++;
    return offset > start;
  }
  function quoted(quote: string, escaping: "backslash" | "double" | "raw"): string {
    offset++; let value = "";
    while (offset < source.length) {
      const c = source[offset++]!;
      if (c === quote) {
        if (escaping === "double" && source[offset] === quote) { value += quote; offset++; continue; }
        return value;
      }
      if (c === "\\" && escaping === "backslash") {
        if (offset === source.length) fail();
        const escaped = source[offset++]!;
        value += escaped;
      } else value += c;
    }
    fail("Unterminated string");
  }
  function qualifier(): { sheet?: string; endSheet?: string; workbook?: string } {
    const start = offset;
    let workbook: string | undefined;
    let bookEnd: number | undefined;
    if (source[offset] === "[" && !grammar.bracketReferences) {
      offset++;
      space();
      if (source[offset] === "'" || source[offset] === '"') workbook = quoted(source[offset]!, grammar.stringEscape);
      else {
        const begin = offset;
        while (offset < source.length && source[offset] !== "]" && !whitespace(source[offset])) offset++;
        workbook = source.slice(begin, offset);
      }
      space();
      if (source[offset++] !== "]") { offset = start; return {}; }
      bookEnd = offset;
    }
    const readSheet = (): string => {
      if (grammar.bracketReferences) {
        // ODF ignores absolute/relative sheet sigils; quoted names must end
        // immediately before the sheet separator (oo_cellref_parse).
        if (grammar.absoluteSheetReferences && source[offset] === "$") offset++;
        if (source[offset] === "'") return quoted("'", grammar.stringEscape);
        const begin = offset;
        while (offset < source.length && source[offset] !== grammar.sheetSeparator &&
          !" []:'\t\r\n".includes(source[offset]!)) offset++;
        return source.slice(begin, offset);
      }
      if (grammar.unquotedSheets) {
        const begin = offset;
        if (grammar.absoluteSheetReferences && source[offset] === "$") offset++;
        while (letter(source[offset]) || digit(source[offset])) offset++;
        return source.slice(begin, offset);
      }
      if (source[offset] === "'") return quoted("'", grammar.stringEscape);
      const begin = offset;
      while (word(source[offset]) && source[offset] !== grammar.sheetSeparator) offset++;
      return source.slice(begin, offset);
    };
    let sheet = readSheet(), endSheet: string | undefined;
    if (grammar.sheetSpans !== false && source[offset] === ":") { offset++; endSheet = readSheet(); }
    if (source[offset] !== grammar.sheetSeparator || !sheet && !grammar.bracketReferences) {
      if (workbook !== undefined) {
        offset = bookEnd!;
        if (source[offset] === grammar.sheetSeparator) offset++;
        return { workbook };
      }
      offset = start; return {};
    }
    offset++;
    if (grammar.absoluteSheetReferences && !grammar.bracketReferences && sheet.startsWith("$")) sheet = sheet.slice(1);
    if (sheet.startsWith("[")) {
      const close = sheet.indexOf("]");
      if (close >= 0) { workbook = sheet.slice(1, close); sheet = sheet.slice(close + 1); }
    }
    if (sheet.includes(":") && !endSheet) { const colon = sheet.indexOf(":"); endSheet = sheet.slice(colon + 1); sheet = sheet.slice(0, colon); }
    return { ...(sheet ? { sheet } : {}), ...(endSheet ? { endSheet } : {}), ...(workbook === undefined ? {} : { workbook }) };
  }
  function axisA1(kind: "row" | "column"): Axis | undefined {
    const start = offset, relative = source[offset] !== "$";
    if (!relative) offset++;
    let value = 0, count = 0;
    while (kind === "row" ? digit(source[offset]) : letter(source[offset])) {
      value = kind === "row" ? value * 10 + Number(source[offset]) : value * 26 + source[offset]!.toUpperCase().charCodeAt(0) - 64;
      offset++; count++;
      if (!Number.isSafeInteger(value)) { offset = start; return undefined; }
    }
    const base = kind === "row" ? grammar.rowBase ?? 1 : 1;
    if (!count || value < base) { offset = start; return undefined; }
    return { value: value - base - (relative ? position[kind] : 0), relative };
  }
  function axisR1C1(marker: string, origin: number): Axis | undefined {
    if (source[offset]?.toUpperCase() !== marker) return undefined;
    offset++;
    if (source[offset] !== "[") {
      const start = offset;
      while (digit(source[offset])) offset++;
      if (start === offset) return { value: 0, relative: true };
      const value = Number(source.slice(start, offset));
      if (!Number.isSafeInteger(value) || value < 1) return undefined;
      return { value: value - 1, relative: false };
    }
    offset++; const start = offset;
    if (source[offset] === "+" || source[offset] === "-") offset++;
    const digits = offset;
    while (digit(source[offset])) offset++;
    const value = Number(source.slice(start, offset));
    if (offset === digits || source[offset++] !== "]" || !Number.isSafeInteger(value) || !Number.isSafeInteger(value + origin)) return undefined;
    return { value, relative: true };
  }
  function endpoint(scope: { sheet?: string; workbook?: string }): ReferenceEndpoint | undefined {
    const start = offset;
    let row: Axis | undefined, column: Axis | undefined;
    if (grammar.address === "r1c1") {
      row = axisR1C1("R", position.row);
      column = axisR1C1("C", position.column);
    } else { column = axisA1("column"); row = axisA1("row"); }
    if ((!row && !column) || grammar.wholeAxisReferences === false && (!row || !column) || word(source[offset]) && !source.startsWith(rangeSeparator, offset)) { offset = start; return undefined; }
    return { ...scope, ...(row ? { row } : {}), ...(column ? { column } : {}) };
  }
  function referenceOrName(): FormulaNode | undefined {
    const start = offset;
    const bracket = grammar.bracketReferences && source[offset] === "[";
    if (bracket) offset++;
    let external: string | undefined;
    if (bracket && source[offset] === "'") {
      const save = offset, candidate = quoted("'", "double");
      if (source[offset] === "#") { external = candidate; offset++; }
      else offset = save;
    }
    const scopeStart = offset;
    const scope = qualifier();
    if (external !== undefined) scope.workbook = external;
    const first = scope.workbook !== undefined && !scope.sheet ? undefined : endpoint(scope);
    if (first) {
      let last: ReferenceEndpoint | undefined;
      if (source.startsWith(rangeSeparator, offset)) {
        const colon = offset; offset += rangeSeparator.length;
        const secondScope = qualifier();
        last = endpoint({ ...scope, ...(scope.endSheet ? { sheet: scope.endSheet } : {}), ...secondScope });
        if (!last) offset = colon;
      }
      if (scope.endSheet && !last) last = { ...first, sheet: scope.endSheet };
      if (first.row && first.column || grammar.address === "r1c1" || last && !!first.row === !!last.row && !!first.column === !!last.column) {
        if (bracket && source[offset++] !== "]") { offset = start; return undefined; }
        return node({ kind: "reference", start, end: offset, first, ...(last ? { last } : {}) });
      }
    }
    offset = scopeStart;
    const nameScope = qualifier();
    if (external !== undefined) nameScope.workbook = external;
    if (nameScope.sheet !== undefined || nameScope.workbook !== undefined) {
      if (grammar.qualifiedNames === false) { offset = start; return undefined; }
      const begin = offset;
      while (word(source[offset])) offset++;
      if (begin !== offset && !digit(source[begin]) && source[offset] !== "(" && (!bracket || source[offset++] === "]")) {
        const name = source.slice(begin, bracket ? offset - 1 : offset);
        if (nameScope.workbook === undefined || nameScope.workbook === "" && nameScope.sheet !== undefined) options.onName?.(name, nameScope.sheet);
        return node({ kind: "name", start, end: offset, name, ...nameScope });
      }
    }
    offset = start; return undefined;
  }
  function primary(stopSeparator: boolean): FormulaNode {
    space(); const start = offset;
    if (++depth > 128) throw new SsconvertError("resource-limit", "ssconvert formula depth limit exceeded");
    try {
      const c = source[offset];
      if (grammar.bracketReferences) for (const spelling of ["[#REF!]", "[.#REF!]", "[.$#REF!]"]) {
        if (source.startsWith(spelling, offset)) {
          offset += spelling.length;
          return node({ kind: "literal", start, end: offset, value: { kind: "error", value: "#REF!" } });
        }
      }
      if (c === "¬" || grammar.hashLogicals && source.startsWith("#NOT#", offset)) {
        offset += c === "¬" ? 1 : 5; const child = expression(8, stopSeparator); return node({ kind: "call", start, end: child.end, name: "NOT", spelling: "NOT", args: [child] });
      }
      if (c === "+" || c === "-") { offset++; const child = expression(8, stopSeparator); return node({ kind: "unary", start, end: child.end, op: c, child }); }
      if (c === "(") {
        offset++; const child = expression(0); space();
        if (source[offset++] !== ")") fail();
        return node({ kind: "parentheses", start, end: offset, child });
      }
      if (c === '"') { const value = quoted('"', grammar.stringEscape); return node({ kind: "literal", start, end: offset, value: { kind: "string", value } }); }
      if (c === "#" && (source[offset + 1] === '"' || source[offset + 1] === "'") && grammar.quotedErrors) {
        offset++; const value = quoted(source[offset]!, grammar.stringEscape);
        return node({ kind: "literal", start, end: offset, value: { kind: "error", value } });
      }
      if (c === "{") {
        offset++; const rows: FormulaNode[][] = []; let row: FormulaNode[] = [];
        while (true) {
          let value = expression(0, true);
          if (value.kind === "literal" && value.value.kind === "string") {
            const text = value.value.value, upper = text.toUpperCase();
            if (upper === "TRUE" || upper === "FALSE") value = node({ ...value, value: { kind: "boolean", value: upper === "TRUE" } });
            else if (["#NAME?", "#REF!", "#VALUE!", "#NUM!", "#DIV/0!", "#N/A", "#NULL!"].includes(text)) value = node({ ...value, value: { kind: "error", value: text } });
            else {
              let begin = 0, end = text.length;
              while (begin < end && " \t\r\n\v\f".includes(text[begin]!)) begin++;
              while (end > begin && " \t\r\n\v\f".includes(text[end - 1]!)) end--;
              let cursor = begin, digits = 0;
              if (text[cursor] === "+" || text[cursor] === "-") cursor++;
              while (cursor < end && digit(text[cursor])) { cursor++; digits++; }
              if (text[cursor] === ".") { cursor++; while (cursor < end && digit(text[cursor])) { cursor++; digits++; } }
              if (digits && cursor < end && text[cursor]?.toUpperCase() === "E") {
                cursor++; if (text[cursor] === "+" || text[cursor] === "-") cursor++;
                const exponentStart = cursor;
                while (cursor < end && digit(text[cursor])) cursor++;
                if (cursor === exponentStart) digits = 0;
              }
              const number = Number(text.slice(begin, end));
              if (digits && cursor === end && Number.isFinite(number)) value = node({ ...value, value: { kind: "number", value: number } });
            }
          }
          if (value.kind !== "literal" && !(value.kind === "unary" && (value.op === "+" || value.op === "-") && value.child.kind === "literal" && value.child.value.kind === "number")) fail("Array elements must be constants", value.start, value.end);
          row.push(value); space();
          if (source[offset] === grammar.arrayColumn) { offset++; continue; }
          rows.push(row); row = [];
          if (source[offset] === grammar.arrayRow) { offset++; continue; }
          if (source[offset++] !== "}") fail();
          if (rows.some(r => r.length !== rows[0]!.length)) fail("Array rows must have equal length", start, offset);
          return node({ kind: "array", start, end: offset, rows });
        }
      }
      for (const value of ["#NAME?", "#REF!", "#VALUE!", "#NUM!", "#DIV/0!", "#N/A", "#NULL!"])
        if (source.slice(offset, offset + value.length).toUpperCase() === value) {
          offset += value.length; return node({ kind: "literal", start, end: offset, value: { kind: "error", value } });
        }
      // Function spellings such as LOG2 and EXPM1 are also valid A1 addresses.
      // A following argument list takes precedence over address recognition.
      let lookahead = offset;
      while (word(source[lookahead])) lookahead++;
      while (whitespace(source[lookahead])) lookahead++;
      const reference = source[lookahead] === "(" && lookahead > offset ? undefined : referenceOrName();
      if (reference) return reference;
      if (c === "'" && grammar.singleQuotedStrings) { const value = quoted("'", grammar.stringEscape); return node({ kind: "literal", start, end: offset, value: { kind: "string", value } }); }
      if (digit(c) || c === ".") {
        while (digit(source[offset])) offset++;
        if (source[offset] === ".") { offset++; while (digit(source[offset])) offset++; }
        if (source[offset]?.toUpperCase() === "E") { offset++; if (source[offset] === "+" || source[offset] === "-") offset++; const begin = offset; while (digit(source[offset])) offset++; if (offset === begin) fail(); }
        const value = Number(source.slice(start, offset));
        if (!Number.isFinite(value) || source.slice(start, offset) === ".") fail();
        return node({ kind: "literal", start, end: offset, value: { kind: "number", value } });
      }
      while (word(source[offset])) offset++;
      if (offset === start) fail();
      const spelling = source.slice(start, offset), nameEnd = offset; space();
      if (source[offset] === "(") {
        offset++; space(); const args: FormulaNode[] = [];
        if (source[offset] !== ")") {
          while (true) {
            space();
            args.push(source[offset] === grammar.arguments || source[offset] === ")" ? node({ kind: "omitted", start: offset, end: offset }) : expression(0, true));
            space(); if (source[offset] !== grammar.arguments) break; offset++;
          }
        }
        if (source[offset++] !== ")") fail();
        let name = spelling.toUpperCase();
        const insertion = grammar.functionArgumentInsertions?.[name];
        if (insertion && args.length === insertion.arity) args.splice(insertion.index, 0, node({ kind: "literal", start: offset, end: offset, value: insertion.value }));
        let prefixed = false;
        for (const prefix of grammar.functionPrefixes) if (name.startsWith(prefix)) {
          name = name.slice(prefix.length);
          name = grammar.functionPrefixAliases?.[prefix]?.[name] ?? name;
          prefixed = true; break;
        }
        if (!prefixed) name = grammar.functionAliases?.[name] ?? name;
        if (grammar.odfRoundingArguments) {
          const imported = spelling.toUpperCase();
          const call = (name: string, args: readonly FormulaNode[]): FormulaNode => node({ kind: "call", start, end: offset, name, spelling: name, args });
          const literal = (value: number): FormulaNode => node({ kind: "literal", start, end: offset, value: { kind: "number", value } });
          if (imported === "CHISQDIST" && args.length === 2) return call("R.PCHISQ", args);
          if ((imported === "COM.MICROSOFT.T.DIST.RT" || imported === "COM.MICROSOFT.T.DIST.2T") && args.length === 2)
            return call("TDIST", [...args, literal(imported.endsWith(".RT") ? 1 : 2)]);
          const distributions: Readonly<Record<string, readonly [number, string, string]>> = {
            "CHISQDIST": [3, "R.PCHISQ", "R.DCHISQ"],
            "COM.MICROSOFT.F.DIST": [4, "R.PF", "R.DF"],
            "COM.MICROSOFT.T.DIST": [3, "R.PT", "R.DT"],
            "COM.MICROSOFT.LOGNORM.DIST": [4, "LOGNORMDIST", "R.DLNORM"],
            "COM.MICROSOFT.NEGBINOM.DIST": [4, "R.PNBINOM", "NEGBINOMDIST"],
            "COM.MICROSOFT.NORM.S.DIST": [2, "R.DNORM", "NORMSDIST"]
          };
          const distribution = distributions[imported];
          if (distribution && args.length === distribution[0]) {
            const cumulative = args[args.length - 1]!, parameters = args.slice(0, -1);
            const p = imported === "COM.MICROSOFT.NORM.S.DIST" ? [...parameters, literal(0), literal(1)] : parameters;
            if (cumulative.kind === "literal" && (cumulative.value.kind === "number" || cumulative.value.kind === "boolean"))
              return call(cumulative.value.value ? distribution[1] : distribution[2], cumulative.value.value ? p : parameters);
            return call("IF", [cumulative, call(distribution[1], p), call(distribution[2], parameters)]);
          }
        }
        // Released XLSX handlers run before ordinary name lookup and reorder
        // quantiles or select density/CDF using the cumulative argument.
        if (grammar.excelNumericHandlers && spelling.toUpperCase().startsWith("_XLFN.")) {
          const imported = spelling.toUpperCase().slice(6);
          const call = (name: string, args: readonly FormulaNode[]): FormulaNode => node({ kind: "call", start, end: offset, name, spelling: name, args });
          if (imported === "BINOM.INV" && args.length >= 3) return call("R.QBINOM", [args[2]!, ...args.slice(0, 2), ...args.slice(3)]);
          const distributions: Readonly<Record<string, readonly [number, string, string]>> = {
            "CHISQ.DIST": [3, "R.PCHISQ", "R.DCHISQ"],
            "F.DIST": [4, "R.PF", "R.DF"],
            "T.DIST": [3, "R.PT", "R.DT"],
            "LOGNORM.DIST": [4, "R.PLNORM", "R.DLNORM"],
            "NEGBINOM.DIST": [4, "R.PNBINOM", "R.DNBINOM"]
          };
          const distribution = distributions[imported];
          if (distribution && args.length === distribution[0]) {
            const cumulative = args[args.length - 1]!, parameters = args.slice(0, -1);
            if (cumulative.kind === "literal" && (cumulative.value.kind === "number" || cumulative.value.kind === "boolean"))
              return call(cumulative.value.value ? distribution[1] : distribution[2], parameters);
            return call("IF", [cumulative, call(distribution[1], parameters), call(distribution[2], parameters)]);
          }
        }
        // Released OpenFormula import rewrites rounding modes into native calls.
        if (!prefixed && grammar.odfRoundingArguments && (name === "FLOOR" || name === "CEILING") && args.length > 0 && args.length <= 3) {
          const call = (name: string, args: readonly FormulaNode[]): FormulaNode => node({ kind: "call", start, end: offset, name, spelling: name, args });
          const literal = (value: number): FormulaNode => node({ kind: "literal", start, end: offset, value: { kind: "number", value } });
          if (name === "CEILING" && args.length === 1) return call("CEIL", args);
          const x = args[0]!, significance = args[1] ?? call("SIGN", [x]);
          const modeOne = call(name, [x, significance]);
          const mode = args[2];
          if (mode?.kind === "literal" && mode.value.kind === "number" && mode.value.value !== 0) return modeOne;
          const modeZero = call("IF", [node({ kind: "binary", start, end: offset, op: "<", left: x, right: literal(0) }), call(name === "FLOOR" ? "CEILING" : "FLOOR", [x, significance]), modeOne]);
          if (!mode || mode.kind === "literal" && mode.value.kind === "number") return modeZero;
          return call("IF", [node({ kind: "binary", start, end: offset, op: "=", left: literal(0), right: mode }), modeZero, modeOne]);
        }
        if (!prefixed && grammar.odfRoundingArguments && (name === "FLOOR" || name === "CEILING")) name = "ODF." + name;
        if (grammar.booleanFunctions && args.length === 0 && (name === "TRUE" || name === "FALSE"))
          return node({ kind: "literal", start, end: offset, value: { kind: "boolean", value: name === "TRUE" } });
        return node({ kind: "call", start, end: offset, name, spelling, args });
      }
      offset = nameEnd;
      const upper = spelling.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return node({ kind: "literal", start, end: offset, value: { kind: "boolean", value: upper === "TRUE" } });
      if (grammar.nativeNames) {
        if (spelling[0] !== "_" && !isUnicodeAlpha(spelling.codePointAt(0)!) || Array.from(spelling).some(c => c !== "_" && !isUnicodeAlphanumeric(c.codePointAt(0)!)))
          fail(`'${spelling}' cannot be used as a name`, start, offset);
        let letters = 0; while (letter(spelling[letters])) letters++;
        let digits = letters; while (digit(spelling[digits])) digits++;
        let reservedR1C1 = false;
        if (spelling[0]?.toUpperCase() === "R") {
          let cursor = 1;
          while (digit(spelling[cursor])) cursor++;
          if (cursor > 1 && spelling[cursor]?.toUpperCase() === "C") {
            const columnStart = ++cursor;
            while (digit(spelling[cursor])) cursor++;
            reservedR1C1 = cursor > columnStart && cursor === spelling.length;
          }
        }
        if (reservedR1C1 || letters > 0 && letters <= 4 && digits > letters && digits === spelling.length || spelling.includes(".") || spelling.includes("$")) fail(`'${spelling}' cannot be used as a name`, start, offset);
      }
      options.onName?.(spelling);
      return node({ kind: "name", start, end: offset, name: spelling });
    } finally { depth--; }
  }
  function referenceLike(value: FormulaNode): boolean {
    return value.kind === "reference" || value.kind === "name" || value.kind === "call" || value.kind === "parentheses" || value.kind === "binary" && [":", "intersection", "union"].includes(value.op);
  }
  function expression(minimum: number, stopSeparator = false): FormulaNode {
    let left = primary(stopSeparator);
    while (true) {
      const before = offset, spaced = space();
      if (stopSeparator && [grammar.arguments, grammar.arrayColumn, grammar.arrayRow].includes(source[offset] ?? "\0")) break;
      if (source[offset] === "%" && minimum <= 7) { offset++; left = node({ kind: "unary", start: left.start, end: offset, op: "%", child: left }); continue; }
      const pair = source.slice(offset, offset + 2);
      let op = ["<=", ">=", "<>", "!=", "=="].includes(pair) ? pair : source[offset] ?? "";
      let width = op.length;
      if (source.startsWith(rangeSeparator, offset)) { op = ":"; width = rangeSeparator.length; }
      else if (op === ":" && rangeSeparator !== ":") { op = ""; width = 0; }
      if (grammar.hashLogicals && source.startsWith("#AND#", offset)) { op = "∧"; width = 5; }
      if (grammar.hashLogicals && source.startsWith("#OR#", offset)) { op = "∨"; width = 4; }
      if (grammar.intersection === " " && spaced && referenceLike(left) && (letter(source[offset]) || source[offset] === "$" || source[offset] === "'" || source[offset] === "[" || source[offset] === "(")) { op = "intersection"; width = 0; }
      else if (grammar.intersection && op === grammar.intersection && grammar.intersection !== " ") op = "intersection";
      else if (op === grammar.union) op = "union";
      const precedence = ["=", "==", "<", ">", "<=", ">=", "<>", "!="].includes(op) ? 1 : op === "&" ? 2 : op === "+" || op === "-" ? 3 :
        op === "*" || op === "/" ? 4 : op === "^" ? 6 : op === "∧" || op === "∨" ? 9 : op === "union" ? 10 : op === "intersection" ? 11 : op === ":" ? 12 : -1;
      if (precedence < minimum) { offset = before; break; }
      if (["union", "intersection", ":"].includes(op) && !referenceLike(left)) fail("Reference operator requires references", left.start, left.end);
      offset += width;
      const right = expression(precedence + (op === "^" && !grammar.leftAssociativePower ? 0 : 1), stopSeparator);
      if (["union", "intersection", ":"].includes(op) && !referenceLike(right)) fail("Reference operator requires references", right.start, right.end);
      left = op === "∧" || op === "∨" ? node({ kind: "call", start: left.start, end: right.end, name: op === "∧" ? "AND" : "OR", spelling: op === "∧" ? "AND" : "OR", args: [left, right] }) :
        node({ kind: "binary", start: left.start, end: right.end, op: op === "==" ? "=" : op === "!=" ? "<>" : op, left, right });
    }
    return left;
  }
  try {
    const root = expression(0); space(); if (offset !== source.length) fail();
    const sheetNames = options.workbook ? Object.freeze(Object.fromEntries(options.workbook.sheets.map(sheet => {
      options.signal?.throwIfAborted();
      return [sheet.id, sheet.name];
    }))) : undefined;
    return { ok: true, document: { source, grammar, position: { ...position }, root, ...(sheetNames ? { sheetNames } : {}) } };
  } catch (error) {
    if (error !== syntax) throw error;
    return { ok: false, source, diagnostic };
  }
}
