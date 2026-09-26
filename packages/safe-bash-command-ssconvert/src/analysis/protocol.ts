import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { AnalysisRequest, ToolTestOptions } from "../solver.js";
import type { Workbook, CellRange } from "../workbook.js";
import { foldSheetName } from "../workbook/case-fold.js";
import { parseRangeExpression, parseRangePrefix } from "../workbook/expressions.js";
import { cNumber } from "../conversion/c-number.js";
import { analysisTools } from "./catalog.js";

export function toolBoolean(text: string): boolean {
  return text === "yes" || text === "y" || text === "true" || text === "1";
}

/** Captured LP64 libc strtol -> int conversion used by atoi, including saturation. */
export function toolInteger(text: string): number {
  let offset = 0;
  while (offset < text.length && " \t\n\r\v\f".includes(text[offset]!)) offset++;
  const negative = text[offset] === "-";
  if (negative || text[offset] === "+") offset++;
  let value = 0n;
  const maximum = negative ? 9223372036854775808n : 9223372036854775807n;
  while (offset < text.length && text[offset]! >= "0" && text[offset]! <= "9") {
    value = value * 10n + BigInt(text.charCodeAt(offset++) - 48);
    if (value > maximum) value = maximum;
  }
  return Number(BigInt.asIntN(32, negative ? -value : value));
}

/** atof additionally recognizes signed, case-insensitive inf/infinity and nan. */
export function toolDouble(text: string): number {
  let offset = 0;
  while (offset < text.length && " \t\n\r\v\f".includes(text[offset]!)) offset++;
  const negative = text[offset] === "-";
  if (negative || text[offset] === "+") offset++;
  const prefix = text.slice(offset, offset + 3).toLowerCase();
  if (prefix === "inf") return negative ? -Infinity : Infinity;
  if (prefix === "nan") return NaN;
  const value = cNumber(text);
  // strtod falls back to the signed decimal zero when a hex prefix has no digits.
  if (value === 0 && negative && text[offset] === "0") return -0;
  return Number.isNaN(value) ? 0 : value;
}

/** GLib's C-locale %f value rendering, including binary64 ties-to-even. */
export function doubleDiagnostic(value: number, source: string, precision = 6): string {
  // JavaScript arithmetic/storage can canonicalize NaN sign bits; retain argv's sign.
  if (Number.isNaN(value)) return source.trimStart().startsWith("-") ? "-nan" : "nan";
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const negative = (bits >> 63n) !== 0n;
  if (!Number.isFinite(value)) return negative ? "-inf" : "inf";
  const exponentBits = Number((bits >> 52n) & 2047n);
  const exponent = (exponentBits || 1) - 1023 - 52;
  const significand = (bits & ((1n << 52n) - 1n)) | (exponentBits ? 1n << 52n : 0n);
  const scale = 10n ** BigInt(precision);
  let scaled = significand * scale;
  if (exponent >= 0) scaled <<= BigInt(exponent);
  else {
    const divisor = 1n << BigInt(-exponent);
    const remainder = scaled % divisor;
    scaled /= divisor;
    if (remainder * 2n > divisor || remainder * 2n === divisor && (scaled & 1n) !== 0n) scaled++;
  }
  return `${negative ? "-" : ""}${scaled / scale}.${(scaled % scale).toString().padStart(precision, "0")}`;
}

/** run_tool_test's preparation, kept separate from numerical analysis engines. */
export async function prepareToolTest(book: Workbook, argv: readonly string[], context: CapabilityContext,
  sourceUri?: string): Promise<AnalysisRequest> {
  context.signal.throwIfAborted();
  const args = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    context.signal.throwIfAborted();
    const argument = argv[i]!;
    const colon = argument.indexOf(":");
    if (colon < 0) {
      await context.diagnostic?.({ code: "tool-argument", severity: "warning",
        message: `Ignoring tool test argument "${argument}"` });
      context.signal.throwIfAborted();
    }
    else args.set(argument.slice(0, colon), argument.slice(colon + 1));
  }
  const tool = argv[0]!;
  const definition = Object.hasOwn(analysisTools, tool) ? analysisTools[tool]! : undefined;
  if (!definition) throw new SsconvertError("invalid-request", `no test for tool "${tool}"`);
  const selected = args.has("sheet") ? book.sheets.find(sheet => foldSheetName(sheet.name) === foldSheetName(args.get("sheet")!))
    : book.sheets.find(sheet => sheet.id === book.activeSheet) ?? book.sheets[0];
  args.delete("sheet");
  if (!selected) throw new SsconvertError("invalid-request", "Analysis tool failed");
  // value_new_cellrange_str uses the selected sheet for both binding and bounds.
  // The shared range parser uses its first sheet's bounds for unqualified input.
  const rangeBook = { ...book, activeSheet: selected.id,
    sheets: [selected, ...book.sheets.filter(sheet => sheet.id !== selected.id)] };
  const range = (name: string): CellRange | null | undefined => {
    const text = args.get(name);
    args.delete(name);
    if (text === undefined) return undefined;
    try {
      const value = parseRangeExpression(text, rangeBook, false, sourceUri);
      if (!["anova2", "regression", "kaplan-meier", "z-test"].includes(tool)) return Object.freeze(value);
      const { relative } = parseRangePrefix(text, rangeBook, sourceUri);
      return Object.freeze({ ...value, startRowRelative: relative.startRow, endRowRelative: relative.endRow,
        startColumnRelative: relative.startColumn, endColumnRelative: relative.endColumn });
    }
    catch (error) { if (!(error instanceof SsconvertError) || error.code !== "invalid-request") throw error; return null; }
  };
  const data = definition.input === "data" ? range("data") ?? undefined : undefined;
  const x = definition.input === "pair" ? range("x") : undefined;
  const y = definition.input === "pair" ? range("y") : undefined;
  const properties: Record<string, string | number | boolean | null> = Object.create(null) as Record<string, string | number | boolean | null>;
  for (const spec of definition.properties) properties[spec.name] = spec.default;
  for (const spec of definition.properties) {
    context.signal.throwIfAborted();
    const arg = args.get(spec.name);
    if (arg === undefined) continue;
    let value: string | number | boolean;
    switch (spec.type) {
      case "string": value = arg; break;
      case "boolean": value = toolBoolean(arg); break;
      case "double": value = toolDouble(arg); break;
      case "uint": value = toolInteger(arg) >>> 0; break;
      case "int": value = toolInteger(arg); break;
      case "enum": {
        const nick = spec.enum && Object.hasOwn(spec.enum, arg) ? spec.enum[arg] : undefined;
        if (nick !== undefined) value = nick;
        else if (arg[0] !== undefined && arg[0] >= "0" && arg[0] <= "9") value = toolInteger(arg);
        else {
          await context.diagnostic?.({ code: "tool-property", severity: "error",
            message: `Cannot parse "${arg}" as value for "${spec.name}"` });
          context.signal.throwIfAborted();
          throw new SsconvertError("invalid-request", "Analysis tool failed");
        }
        break;
      }
    }
    // GObject rejects values requiring GParamSpec validation; it retains the old value.
    const invalid = typeof value === "number" && (Number.isNaN(value) || spec.minimum !== undefined && value < spec.minimum ||
      spec.maximum !== undefined && value > spec.maximum || spec.enum !== undefined && !Object.values(spec.enum).includes(value));
    if (!invalid) {
      properties[spec.name] = value;
      if (spec.setterEffects) Object.assign(properties, spec.setterEffects);
    }
    else {
      const nativeType = spec.type === "enum" ? spec.enumType! : `g${spec.type}`;
      const rendered = spec.type === "enum" ? `((${nativeType}) ${value})`
        : spec.type === "double" ? doubleDiagnostic(value as number, arg) : `${value}`;
      await context.diagnostic?.({ code: "tool-property-range", severity: "warning",
        message: `value "${rendered}" of type '${nativeType}' is invalid or out of range for property '${spec.name}' of type '${nativeType}'` });
      context.signal.throwIfAborted();
    }
    args.delete(spec.name);
  }
  const putFormulas = args.has("formulas") ? toolBoolean(args.get("formulas")!) : true;
  args.delete("formulas");
  let outputName = definition.outputName;
  if (tool === "anova2" && properties.replication !== 1) outputName = "Two Factor ANOVA with Replication";
  if (tool === "chi-squared-test") outputName = properties.independence ? "Test of Independence" : "Test of Homogeneity";
  let counter = 1;
  while (book.sheets.some(sheet => foldSheetName(sheet.name) === foldSheetName(`${outputName} (${counter})`))) counter++;
  const referenceError = Object.freeze({ kind: "error" as const, value: "#REF!" as const });
  const options: ToolTestOptions = Object.freeze({ sheet: selected.id, putFormulas,
    outputSheetName: `${outputName} (${counter})`, properties: Object.freeze(properties),
    ...(data === undefined ? {} : { data }), ...(definition.input === "pair"
      ? { x: x === undefined ? referenceError : x, y: y === undefined ? referenceError : y } : {}) });
  // Retain the existing raw capability contract alongside the interpreted protocol.
  const raw = new Map<string, string>();
  for (const argument of argv.slice(1)) {
    const colon = argument.indexOf(":");
    if (colon >= 0) raw.set(argument.slice(0, colon), argument.slice(colon + 1));
  }
  return Object.freeze({ tool, properties: Object.freeze([...raw].map(([name, value]) => Object.freeze({ name, value }))), toolOptions: options });
}
