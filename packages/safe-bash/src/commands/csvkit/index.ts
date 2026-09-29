import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createCsvkitCommands as createRawCsvkitCommands,
  defaultHeaders,
  inferTable,
  readCsv,
  sniff,
  POSSIBLE_DELIMITERS,
  Decimal,
  pythonValueText,
  writeCsvRow,
  parseColumnIdentifiers,
  matchColumnIdentifier,
  type CsvDialect,
  type CsvkitCommandsOptions,
  type InferenceOptions,
  type TableValue,
} from "safe-bash-command-csvkit";

export * from "safe-bash-command-csvkit";

function isDefaultCsvkitOptions(options?: CsvkitCommandsOptions): boolean {
  if (!options) return true;
  return (
    options.limits === undefined &&
    options.codecs === undefined &&
    options.locale === undefined &&
    options.clock === undefined &&
    options.terminal === undefined &&
    options.compression === undefined &&
    options.databases === undefined &&
    options.sqlDialects === undefined &&
    options.interpreter === undefined &&
    options.openMatchFile === undefined &&
    options.sniffing === undefined &&
    options.columnWarnings === undefined &&
    options.probeInputOpen === undefined
  );
}

export function createCsvkitCommands(options: CsvkitCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawCsvkitCommands(options);
  if (isDefaultCsvkitOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function csvkitCommands(options: CsvkitCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCsvkitCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "csvkit-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          const existing = host.commands.get(command.name);
          if (existing && !(command.fallback && !existing.fallback)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace });
      }
    },
  };
}

const syncUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface ParsedSyncCsvkitOptions {
  delimiter?: string;
  tabs: boolean;
  quotechar?: string;
  escapechar?: string;
  noDoublequote: boolean;
  skipInitialSpace: boolean;
  noHeaderRow: boolean;
  skipLines: number;
  lineNumbers: boolean;
  addBom: boolean;
  noInference: boolean;
  blanks: boolean;
  noLeadingZeroes: boolean;
  sniffLimit: number;
  maxRows?: number;
  maxColumns?: number;
  maxColumnWidth?: number;
  maxPrecision?: number;
  noNumberEllipsis: boolean;
  indent: number | null;
  key: string | null;
  streamOutput: boolean;
  filePath?: string;
}

function parseSyncCsvkitCommon(opArgs: readonly string[], mode: "csvlook" | "csvjson"): ParsedSyncCsvkitOptions | undefined {
  const res: ParsedSyncCsvkitOptions = {
    tabs: false,
    noDoublequote: false,
    skipInitialSpace: false,
    noHeaderRow: false,
    skipLines: 0,
    lineNumbers: false,
    addBom: false,
    noInference: false,
    blanks: false,
    noLeadingZeroes: false,
    sniffLimit: 1024,
    noNumberEllipsis: false,
    indent: null,
    key: null,
    streamOutput: false,
  };
  let positionalDone = false;
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!positionalDone && a === "--") {
      positionalDone = true;
      continue;
    }
    if (!positionalDone && a.startsWith("-") && a !== "-") {
      if (a === "-t" || a === "--tabs") { res.tabs = true; continue; }
      if (a === "-b" || a === "--no-doublequote") { res.noDoublequote = true; continue; }
      if (a === "-S" || a === "--skipinitialspace") { res.skipInitialSpace = true; continue; }
      if (a === "-H" || a === "--no-header-row") { res.noHeaderRow = true; continue; }
      if (a === "-l" || a === "--linenumbers") { res.lineNumbers = true; continue; }
      if (a === "--add-bom") { res.addBom = true; continue; }
      if (a === "-I" || a === "--no-inference") { res.noInference = true; continue; }
      if (a === "--blanks") { res.blanks = true; continue; }
      if (a === "--no-leading-zeroes") { res.noLeadingZeroes = true; continue; }
      if (a === "-d" || a.startsWith("-d") || a === "--delimiter" || a.startsWith("--delimiter=")) {
        const v = a.startsWith("--delimiter=") ? a.slice(12) : a.startsWith("-d=") ? a.slice(3) : a.length > 2 && a.startsWith("-d") ? a.slice(2) : opArgs[++i];
        if (!v || Array.from(v).length !== 1) return undefined;
        res.delimiter = v;
        continue;
      }
      if (a === "-q" || a.startsWith("-q") || a === "--quotechar" || a.startsWith("--quotechar=")) {
        const v = a.startsWith("--quotechar=") ? a.slice(12) : a.startsWith("-q=") ? a.slice(3) : a.length > 2 && a.startsWith("-q") ? a.slice(2) : opArgs[++i];
        if (!v || Array.from(v).length !== 1) return undefined;
        res.quotechar = v;
        continue;
      }
      if (a === "-p" || a === "--escapechar") {
        const v = opArgs[++i];
        if (!v || Array.from(v).length !== 1) return undefined;
        res.escapechar = v;
        continue;
      }
      if (a === "-K" || a.startsWith("-K") || a === "--skip-lines" || a.startsWith("--skip-lines=")) {
        const v = a.startsWith("--skip-lines=") ? a.slice(13) : a.startsWith("-K=") ? a.slice(3) : a.length > 2 && a.startsWith("-K") ? a.slice(2) : opArgs[++i];
        if (v === undefined || !/^[0-9]+$/.test(v)) return undefined;
        res.skipLines = Number(v);
        continue;
      }
      if (a === "-y" || a === "--snifflimit") {
        const v = opArgs[++i];
        if (v === undefined || !/^-?[0-9]+$/.test(v)) return undefined;
        res.sniffLimit = Number(v);
        continue;
      }
      if (mode === "csvlook") {
        if (a === "--no-number-ellipsis") { res.noNumberEllipsis = true; continue; }
        if (a === "--max-rows" || a === "--max-columns" || a === "--max-column-width" || a === "--max-precision") {
          const v = opArgs[++i];
          if (v === undefined || !/^[0-9]+$/.test(v)) return undefined;
          const n = Number(v);
          if (a === "--max-rows") res.maxRows = n;
          else if (a === "--max-columns") res.maxColumns = n;
          else if (a === "--max-column-width") res.maxColumnWidth = n;
          else res.maxPrecision = n;
          continue;
        }
      } else {
        if (a === "--stream") { res.streamOutput = true; continue; }
        if (a === "-i" || a.startsWith("-i") || a === "--indent" || a.startsWith("--indent=")) {
          const v = a.startsWith("--indent=") ? a.slice(9) : a.startsWith("-i=") ? a.slice(3) : a.length > 2 && a.startsWith("-i") ? a.slice(2) : opArgs[++i];
          if (v === undefined || !/^[0-9]+$/.test(v)) return undefined;
          res.indent = Number(v);
          continue;
        }
        if (a === "-k" || a.startsWith("-k") || a === "--key" || a.startsWith("--key=")) {
          const v = a.startsWith("--key=") ? a.slice(6) : a.startsWith("-k=") ? a.slice(3) : a.length > 2 && a.startsWith("-k") ? a.slice(2) : opArgs[++i];
          if (v === undefined) return undefined;
          res.key = v;
          continue;
        }
      }
      if (!a.startsWith("--") && a.length > 2) {
        let ok = true;
        for (let j = 1; j < a.length; j++) {
          const ch = a[j]!;
          if (ch === "t") res.tabs = true;
          else if (ch === "b") res.noDoublequote = true;
          else if (ch === "S") res.skipInitialSpace = true;
          else if (ch === "H") res.noHeaderRow = true;
          else if (ch === "l") res.lineNumbers = true;
          else if (ch === "I") res.noInference = true;
          else { ok = false; break; }
        }
        if (ok) continue;
      }
      return undefined;
    }
    if (res.filePath !== undefined) return undefined;
    res.filePath = a;
  }
  return res;
}

function loadSyncTypedTable(
  inBytes: Uint8Array | undefined,
  opts: ParsedSyncCsvkitOptions,
  readFileSync?: (filePath: string) => Uint8Array | undefined,
) {
  let sourceBytes = inBytes;
  if (opts.filePath !== undefined && opts.filePath !== "-") {
    if (!readFileSync) return undefined;
    sourceBytes = readFileSync(opts.filePath);
  }
  if (!sourceBytes || sourceBytes.byteLength > 16384) return undefined;
  let text: string;
  try {
    text = syncUtf8Decoder.decode(sourceBytes);
  } catch {
    return undefined;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (opts.skipLines > 0) {
    let linesLeft = opts.skipLines;
    let pos = 0;
    while (pos < text.length && linesLeft > 0) {
      const ch = text[pos++];
      if (ch === "\r") {
        if (text[pos] === "\n") pos++;
        linesLeft--;
      } else if (ch === "\n") {
        linesLeft--;
      }
    }
    text = text.slice(pos);
  }
  const explicitDelimiter = opts.tabs ? "\t" : opts.delimiter;
  let dialect: CsvDialect = {
    ...(explicitDelimiter !== undefined ? { delimiter: explicitDelimiter } : {}),
    ...(opts.quotechar !== undefined ? { quotechar: opts.quotechar } : {}),
    ...(opts.escapechar !== undefined ? { escapechar: opts.escapechar } : {}),
    doublequote: !opts.noDoublequote,
    skipinitialspace: opts.skipInitialSpace,
  };
  if (
    !opts.tabs &&
    opts.delimiter === undefined &&
    opts.quotechar === undefined &&
    opts.escapechar === undefined &&
    !opts.noDoublequote &&
    !opts.skipInitialSpace &&
    opts.sniffLimit !== 0 &&
    text.length > 0
  ) {
    const sample = opts.sniffLimit > 0 ? text.slice(0, opts.sniffLimit) : text;
    if (sample.includes(",") && !/[\t;|:\x27]/.test(sample)) {
      dialect = { delimiter: ",", quotechar: "\"", doublequote: true, skipinitialspace: false };
    } else {
      const sniffed = sniff(sample);
      if (sniffed) dialect = sniffed;
    }
  }
  let headers: readonly string[] | undefined;
  const rows: (readonly string[])[] = [];
  const rowLimit = opts.maxRows;
  for (const record of readCsv(text, dialect)) {
    const values = record.cells.map(c => pythonValueText(c));
    const cells = opts.lineNumbers
      ? [!opts.noHeaderRow && record.line === 1 ? "line_numbers" : String(record.line - (opts.noHeaderRow ? 0 : 1)), ...values]
      : values;
    if (headers === undefined) {
      headers = opts.noHeaderRow ? defaultHeaders(cells.length) : cells;
      if (headers.some(name => !name) || new Set(headers).size !== headers.length) return undefined;
      if (!opts.noHeaderRow) {
        if (rowLimit === 0) break;
        continue;
      }
    }
    rows.push(cells);
    if (rowLimit !== undefined && rows.length >= rowLimit) break;
  }
  const inferenceOpts: InferenceOptions = {
    now: Date.now(),
    timezone: "UTC",
    noInference: opts.noInference,
    numberTextOnly: false,
    blanks: opts.blanks,
    nullValues: [],
    noLeadingZeroes: opts.noLeadingZeroes,
    maxDecimalDigits: Infinity,
    maxDecimalExponent: Infinity,
  };
  return inferTable(headers ?? [], rows, inferenceOpts);
}

function syncPrecision(values: readonly TableValue[]): number {
  let whole = 1;
  let places = 0;
  for (const value of values) {
    if (value === null || typeof value !== "object" || value.kind !== "decimal") continue;
    const d = Decimal.parse(value.value).normalized();
    if (d.special || Math.abs(Number(d.toString())) === Infinity) continue;
    places = Math.max(places, -d.exponent);
    whole = Math.max(whole, d.coefficient.toString().length + d.exponent);
  }
  return Math.min(places, 28 - whole);
}

function syncNumberText(value: string, places: number, ellipsis: string): string {
  const d = Decimal.parse(value);
  if (d.special === "Infinity" || Math.abs(Number(d.toString())) === Infinity) return value;
  places = Math.max(0, places);
  if (d.special) {
    const digits = "NaN" + d.payload;
    let grouped = "";
    for (let i = 0; i < digits.length; i++) {
      if (i && (digits.length - i) % 3 === 0) grouped += ",";
      grouped += digits[i];
    }
    return grouped + (places ? "." + "0".repeat(places) : "") + ellipsis;
  }
  let coefficient = d.coefficient;
  const shift = d.exponent + places;
  if (shift >= 0) coefficient *= 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    const rest = coefficient % divisor;
    coefficient /= divisor;
    if (rest * 2n > divisor || (rest * 2n === divisor && coefficient % 2n !== 0n)) coefficient++;
  }
  if (coefficient.toString().length > 28) throw new Error("InvalidOperation");
  const digits = coefficient.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  let grouped = "";
  for (let i = 0; i < whole.length; i++) {
    if (i && (whole.length - i) % 3 === 0) grouped += ",";
    grouped += whole[i];
  }
  return (d.negative ? "-" : "") + grouped + (places ? "." + digits.slice(-places) : "") + ellipsis;
}

export function evalSyncCsvlook(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const opts = parseSyncCsvkitCommon(opArgs, "csvlook");
    if (!opts) return undefined;
    const table = loadSyncTypedTable(inBytes, opts, readFileSync);
    if (!table) return undefined;
    const maxColumns = opts.maxColumns ?? table.headers.length;
    const width = opts.maxColumnWidth;
    const maxPrecision = opts.maxPrecision ?? 3;
    const cpLen = (v: string): number => Array.from(v).length;
    const truncate = (v: string): string => {
      const chars = Array.from(v);
      return width !== undefined && chars.length > width ? chars.slice(0, width - 3).join("") + "..." : v;
    };
    const names = table.headers.slice(0, maxColumns).map(truncate);
    if (maxColumns < table.headers.length) names.push("...");
    const widths = names.map(cpLen);
    const formats = table.columns.map((column, index) => {
      if (index >= maxColumns || column.type !== "Number") return undefined;
      const places = syncPrecision(table.rows.map(row => row[index]!));
      return { places: Math.min(places, maxPrecision), ellipsis: places > maxPrecision && !opts.noNumberEllipsis ? "…" : "" };
    });
    const renderedRows = table.rows.map(row => {
      const cells: string[] = [];
      for (const [j, value] of row.entries()) {
        const format = formats[j];
        let text =
          j >= maxColumns
            ? "..."
            : value === null
              ? ""
              : format && typeof value === "object" && value.kind === "decimal"
                ? syncNumberText(value.value, format.places, format.ellipsis)
                : pythonValueText(value).replaceAll("\n", "↵");
        text = truncate(text);
        widths[j] = Math.max(widths[j]!, cpLen(text));
        cells.push(text);
        if (j >= maxColumns) break;
      }
      return cells;
    });
    const formatRow = (cells: readonly string[]): string => {
      const fields = cells.map((cell, j) => {
        const col = table.columns[j];
        if (!col) throw new Error("IndexError");
        const spaces = widths[j]! - cpLen(cell);
        const padding = " ".repeat(Math.max(0, spaces));
        return col.type === "Text" ? " " + cell + padding + " " : " " + padding + cell + " ";
      });
      return "|" + fields.join("|") + "|\n";
    };
    let out = opts.addBom ? "\ufeff" : "";
    out += formatRow(names);
    out += "| " + widths.map(size => "-".repeat(size)).join(" | ") + " |\n";
    for (const row of renderedRows) out += formatRow(row);
    return out;
  } catch {
    return undefined;
  }
}

type SyncJsonVal = string | number | boolean | null | readonly SyncJsonVal[] | ReadonlyMap<string, SyncJsonVal>;

function syncFloatText(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value < 0 ? "-Infinity" : "Infinity";
  if (Object.is(value, -0)) return "-0.0";
  const exponent = Number(value.toExponential().split("e")[1]);
  if (value !== 0 && (exponent < -4 || exponent >= 16)) {
    const [digits, power] = value.toExponential().split("e");
    const exp = Number(power);
    return digits + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  }
  return String(value) + (Number.isInteger(value) ? ".0" : "");
}

function emitSyncJson(cur: SyncJsonVal, indent: number | null, d = 0): string {
  if (typeof cur === "number") return syncFloatText(cur);
  if (cur === null || typeof cur === "string" || typeof cur === "boolean") return JSON.stringify(cur);
  if (cur instanceof Map) {
    let buf = "{";
    let index = 0;
    const childPad = indent !== null ? "\n" + " ".repeat(indent * (d + 1)) : "";
    for (const [key, child] of cur.entries()) {
      if (index++) buf += indent === null ? ", " : ",";
      if (indent !== null) buf += childPad;
      buf += JSON.stringify(key) + ": " + emitSyncJson(child, indent, d + 1);
    }
    if (cur.size && indent !== null) buf += "\n" + " ".repeat(indent * d);
    buf += "}";
    return buf;
  }
  const arr = cur as readonly SyncJsonVal[];
  let buf = "[";
  const childPad = indent !== null ? "\n" + " ".repeat(indent * (d + 1)) : "";
  for (let index = 0; index < arr.length; index++) {
    if (index) buf += indent === null ? ", " : ",";
    if (indent !== null) buf += childPad;
    buf += emitSyncJson(arr[index]!, indent, d + 1);
  }
  if (arr.length && indent !== null) buf += "\n" + " ".repeat(indent * d);
  buf += "]";
  return buf;
}

export function evalSyncCsvjson(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const opts = parseSyncCsvkitCommon(opArgs, "csvjson");
    if (!opts) return undefined;
    if (opts.streamOutput && opts.key !== null) return undefined;
    if (opts.streamOutput && opts.indent !== null) return undefined;
    const table = loadSyncTypedTable(inBytes, opts, readFileSync);
    if (!table) return undefined;
    const jsonify = (value: TableValue): string | number | boolean | null => {
      if (typeof value !== "object" || value === null) return value;
      if (value.kind === "decimal") return value.value.includes("NaN") ? NaN : Number(value.value);
      if (value.kind === "datetime") return value.value.replace(" ", "T");
      return pythonValueText(value);
    };
    const rows = table.rows.map(
      row => new Map<string, SyncJsonVal>(table.headers.map((name, index) => [name, jsonify(row[index]!)])),
    );
    let output: SyncJsonVal = rows;
    if (opts.key !== null) {
      const column = table.headers.indexOf(opts.key);
      if (column < 0 && rows.length) return undefined;
      const keyed = new Map<string, SyncJsonVal>();
      for (const [index, row] of table.rows.entries()) {
        const cell = row[column]!;
        const value =
          cell === null
            ? "None"
            : typeof cell === "object" && cell.kind === "decimal"
              ? Decimal.parse(cell.value).normalized().toString()
              : pythonValueText(cell);
        if (keyed.has(value)) return undefined;
        keyed.set(value, rows[index]!);
      }
      output = keyed;
    }
    let out = opts.addBom ? "\ufeff" : "";
    if (opts.streamOutput) {
      for (const row of rows) {
        out += emitSyncJson(row, opts.indent) + "\n";
      }
      return out;
    }
    out += emitSyncJson(output, opts.indent);
    return out;
  } catch {
    return undefined;
  }
}


export function evalSyncCsvsort(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let columnsSpec: string | null = null;
    let reverse = false;
    let ignoreCase = false;
    let namesOnly = false;
    let zeroBased = false;
    const filteredArgs: string[] = [];
    let posDone = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!posDone && a === "--") { posDone = true; filteredArgs.push(a); continue; }
      if (!posDone && a.startsWith("-") && a !== "-") {
        if (a === "-r" || a === "--reverse") { reverse = true; continue; }
        if (a === "-i" || a === "--ignore-case") { ignoreCase = true; continue; }
        if (a === "-n" || a === "--names") { namesOnly = true; continue; }
        if (a === "--zero") { zeroBased = true; continue; }
        if (a === "-ri" || a === "-ir") { reverse = true; ignoreCase = true; continue; }
        if (a === "-c" || a.startsWith("-c") || a === "--columns" || a.startsWith("--columns=")) {
          const v = a.startsWith("--columns=") ? a.slice(10) : a.startsWith("-c=") ? a.slice(3) : a.length > 2 && a.startsWith("-c") ? a.slice(2) : opArgs[++i];
          if (v === undefined) return undefined;
          columnsSpec = v;
          continue;
        }
      }
      filteredArgs.push(a);
    }
    const opts = parseSyncCsvkitCommon(filteredArgs, "csvlook");
    if (!opts) return undefined;
    const table = loadSyncTypedTable(inBytes, opts, readFileSync);
    if (!table) return undefined;
    let out = opts.addBom ? "\ufeff" : "";
    if (namesOnly) {
      if (opts.noHeaderRow) return undefined;
      for (let i = 0; i < table.headers.length; i++) {
        out += `${String(i + (zeroBased ? 0 : 1)).padStart(3, " ")}: ${table.headers[i]}\n`;
      }
      return out;
    }
    const columns = parseColumnIdentifiers(columnsSpec, table.headers, zeroBased ? 0 : 1, null, () => {}, true);
    const rows = [...table.rows];
    const keyed = rows.map(row =>
      columns.map(idx => {
        const val = row[idx]!;
        return ignoreCase && typeof val === "string" ? val.toUpperCase() : val;
      }),
    );
    const indices = rows.map((_, i) => i);
    indices.sort((a, b) => {
      for (let c = 0; c < columns.length; c++) {
        const x = keyed[a]![c]!;
        const y = keyed[b]![c]!;
        let order = 0;
        if (x === null || y === null) order = x === null ? (y === null ? 0 : 1) : -1;
        else if (typeof x === "string" && typeof y === "string") {
          order = x < y ? -1 : x > y ? 1 : 0;
        } else if (typeof x === "boolean" && typeof y === "boolean") {
          order = Number(x) - Number(y);
        } else if (typeof x === "object" && typeof y === "object" && x.kind === "decimal" && y.kind === "decimal") {
          if (x.value.includes("NaN") || y.value.includes("NaN")) throw new Error("NaN");
          order = Decimal.parse(x.value).compare(Decimal.parse(y.value));
        } else if (typeof x === "object" && typeof y === "object" && (x.kind === "date" || x.kind === "datetime") && (y.kind === "date" || y.kind === "datetime") && x.kind === y.kind) {
          order = x.value < y.value ? -1 : x.value > y.value ? 1 : 0;
        } else if (typeof x === "object" && typeof y === "object" && x.kind === "timedelta" && y.kind === "timedelta") {
          order = x.microseconds < y.microseconds ? -1 : x.microseconds > y.microseconds ? 1 : 0;
        } else {
          throw new Error("unsupported type");
        }
        if (order !== 0) return reverse ? -order : order;
      }
      return 0;
    });
    const outDialect: CsvDialect = { delimiter: ",", quotechar: "\"", doublequote: true, lineterminator: "\n" };
    out += writeCsvRow(table.headers, outDialect);
    for (const idx of indices) {
      const formattedCells = rows[idx]!.map(v => {
        if (v === null) return "";
        if (typeof v === "object" && v.kind === "datetime") return v.value.replace(" ", "T");
        return pythonValueText(v);
      });
      out += writeCsvRow(formattedCells, outDialect);
    }
    return out;
  } catch {
    return undefined;
  }
}

export function evalSyncCsvformat(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let outDelimiter = ",";
    let outTabs = false;
    let outAsv = false;
    let outQuotechar = "\"";
    let outQuoting = 0;
    let outNoDoublequote = false;
    let outEscapechar: string | undefined;
    let outLineterminator = "\n";
    let skipHeader = false;
    const filteredArgs: string[] = [];
    let posDone = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!posDone && a === "--") { posDone = true; filteredArgs.push(a); continue; }
      if (!posDone && a.startsWith("-") && a !== "-") {
        if (a === "-E" || a === "--skip-header") { skipHeader = true; continue; }
        if (a === "-T" || a === "--out-tabs") { outTabs = true; continue; }
        if (a === "-A" || a === "--out-asv") { outAsv = true; continue; }
        if (a === "-B" || a === "--out-no-doublequote") { outNoDoublequote = true; continue; }
        if (a === "-D" || a.startsWith("-D") || a === "--out-delimiter" || a.startsWith("--out-delimiter=")) {
          const v = a.startsWith("--out-delimiter=") ? a.slice(16) : a.startsWith("-D=") ? a.slice(3) : a.length > 2 && a.startsWith("-D") ? a.slice(2) : opArgs[++i];
          if (!v || Array.from(v).length !== 1) return undefined;
          outDelimiter = v;
          continue;
        }
        if (a === "-Q" || a.startsWith("-Q") || a === "--out-quotechar" || a.startsWith("--out-quotechar=")) {
          const v = a.startsWith("--out-quotechar=") ? a.slice(16) : a.startsWith("-Q=") ? a.slice(3) : a.length > 2 && a.startsWith("-Q") ? a.slice(2) : opArgs[++i];
          if (!v || Array.from(v).length !== 1) return undefined;
          outQuotechar = v;
          continue;
        }
        if (a === "-P" || a === "--out-escapechar") {
          const v = opArgs[++i];
          if (!v || Array.from(v).length !== 1) return undefined;
          outEscapechar = v;
          continue;
        }
        if (a === "-M" || a.startsWith("-M") || a === "--out-lineterminator" || a.startsWith("--out-lineterminator=")) {
          const v = a.startsWith("--out-lineterminator=") ? a.slice(21) : a.startsWith("-M=") ? a.slice(3) : a.length > 2 && a.startsWith("-M") ? a.slice(2) : opArgs[++i];
          if (v === undefined) return undefined;
          outLineterminator = v;
          continue;
        }
        if (a === "-U" || a.startsWith("-U") || a === "--out-quoting" || a.startsWith("--out-quoting=")) {
          const v = a.startsWith("--out-quoting=") ? a.slice(14) : a.startsWith("-U=") ? a.slice(3) : a.length > 2 && a.startsWith("-U") ? a.slice(2) : opArgs[++i];
          if (v === undefined || !/^[0123]$/.test(v)) return undefined;
          outQuoting = Number(v);
          continue;
        }
      }
      filteredArgs.push(a);
    }
    const opts = parseSyncCsvkitCommon(filteredArgs, "csvlook");
    if (!opts) return undefined;
    let sourceBytes = inBytes;
    if (opts.filePath !== undefined && opts.filePath !== "-") {
      if (!readFileSync) return undefined;
      sourceBytes = readFileSync(opts.filePath);
    }
    if (!sourceBytes || sourceBytes.byteLength > 16384) return undefined;
    let text = syncUtf8Decoder.decode(sourceBytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (opts.skipLines > 0) {
      let linesLeft = opts.skipLines;
      let pos = 0;
      while (pos < text.length && linesLeft > 0) {
        const ch = text[pos++];
        if (ch === "\r") {
          if (text[pos] === "\n") pos++;
          linesLeft--;
        } else if (ch === "\n") linesLeft--;
      }
      text = text.slice(pos);
    }
    const explicitInDelimiter = opts.tabs ? "\t" : opts.delimiter;
    let inDialect: CsvDialect = {
      ...(explicitInDelimiter !== undefined ? { delimiter: explicitInDelimiter } : {}),
      ...(opts.quotechar !== undefined ? { quotechar: opts.quotechar } : {}),
      ...(opts.escapechar !== undefined ? { escapechar: opts.escapechar } : {}),
      doublequote: !opts.noDoublequote,
      skipinitialspace: opts.skipInitialSpace,
    };
    if (
      !opts.tabs &&
      opts.delimiter === undefined &&
      opts.quotechar === undefined &&
      opts.escapechar === undefined &&
      !opts.noDoublequote &&
      !opts.skipInitialSpace &&
      opts.sniffLimit !== 0 &&
      text.length > 0
    ) {
      const sample = opts.sniffLimit > 0 ? text.slice(0, opts.sniffLimit) : text;
      if (sample.includes(",") && !/[\t;|:\x27]/.test(sample)) {
        inDialect = { delimiter: ",", quotechar: "\"", doublequote: true, skipinitialspace: false };
      } else {
        const sniffed = sniff(sample);
        if (sniffed) inDialect = sniffed;
      }
    }
    const outDialect: CsvDialect = {
      delimiter: outAsv ? "\x1f" : outTabs ? "\t" : outDelimiter,
      lineterminator: outAsv ? "\x1e" : outLineterminator,
      quotechar: outQuotechar,
      quoting: outQuoting,
      doublequote: !outNoDoublequote,
      ...(outEscapechar !== undefined ? { escapechar: outEscapechar } : {}),
    };
    writeCsvRow([], outDialect);
    let out = opts.addBom ? "\ufeff" : "";
    let first = true;
    for (const record of readCsv(text, inDialect)) {
      const values = record.cells.map(c => pythonValueText(c));
      if (first) {
        first = false;
        if (opts.noHeaderRow) {
          if (!skipHeader) {
            const hdr = defaultHeaders(values.length);
            out += writeCsvRow(opts.lineNumbers ? ["line_number", ...hdr] : hdr, outDialect);
          }
        } else {
          if (!skipHeader) {
            out += writeCsvRow(opts.lineNumbers ? ["line_number", ...values] : values, outDialect);
          }
          continue;
        }
      }
      const rowCells = opts.lineNumbers ? [String(record.line - (opts.noHeaderRow ? 0 : 1)), ...values] : values;
      out += writeCsvRow(rowCells, outDialect);
    }
    return out;
  } catch {
    return undefined;
  }
}

export function evalSyncCsvstat(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let countOnly = false;
    let namesOnly = false;
    let zeroBased = false;
    let noGrouping = false;
    let columnsSpec: string | null = null;
    let metricOp: "type" | "nulls" | "nonnulls" | "unique" | "min" | "max" | "sum" | "mean" | "median" | "stdev" | "max_precision" | "len" | undefined;
    const filteredArgs: string[] = [];
    let posDone = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!posDone && a === "--") { posDone = true; filteredArgs.push(a); continue; }
      if (!posDone && a.startsWith("-") && a !== "-") {
        if (a === "--count") { countOnly = true; continue; }
        if (a === "-n" || a === "--names") { namesOnly = true; continue; }
        if (a === "--zero") { zeroBased = true; continue; }
        if (a === "-G" || a === "--no-grouping-separator") { noGrouping = true; continue; }
        if (a === "-c" || a.startsWith("-c") || a === "--columns" || a.startsWith("--columns=")) {
          const v = a.startsWith("--columns=") ? a.slice(10) : a.startsWith("-c=") ? a.slice(3) : a.length > 2 && a.startsWith("-c") ? a.slice(2) : opArgs[++i];
          if (!v) return undefined;
          columnsSpec = v;
          continue;
        }
        const mMap: Record<string, typeof metricOp> = {
          "--type": "type", "--nulls": "nulls", "--non-nulls": "nonnulls",
          "--unique": "unique", "--min": "min", "--max": "max",
          "--sum": "sum", "--mean": "mean", "--median": "median",
          "--stdev": "stdev", "--max-precision": "max_precision", "--len": "len",
        };
        if (mMap[a]) {
          if (metricOp !== undefined) return undefined;
          metricOp = mMap[a];
          continue;
        }
      }
      filteredArgs.push(a);
    }
    const modeCount = (countOnly ? 1 : 0) + (namesOnly ? 1 : 0) + (metricOp ? 1 : 0);
    if (modeCount !== 1) return undefined;
    const opts = parseSyncCsvkitCommon(filteredArgs, "csvlook");
    if (!opts) return undefined;
    const table = loadSyncTypedTable(inBytes, opts, readFileSync);
    if (!table) return undefined;
    let out = opts.addBom ? "\ufeff" : "";
    if (namesOnly) {
      if (opts.noHeaderRow) return undefined;
      for (let i = 0; i < table.headers.length; i++) {
        out += `${String(i + (zeroBased ? 0 : 1)).padStart(3, " ")}: ${table.headers[i]}\n`;
      }
      return out;
    }
    if (countOnly) {
      return out + `${table.rows.length}\n`;
    }
    const ids = parseColumnIdentifiers(columnsSpec, table.headers, zeroBased ? 0 : 1, undefined, () => {}, true);
    const fmtDec = (d: Decimal): string => {
      const num = Number(d.toString());
      if (!Number.isFinite(num)) return d.toString();
      let s = num.toFixed(3);
      while (s.endsWith("0")) s = s.slice(0, -1);
      if (s.endsWith(".")) s = s.slice(0, -1);
      if (!noGrouping) {
        const [intPart = "", fracPart] = s.split(".");
        const sign = intPart.startsWith("-") ? "-" : "";
        const digits = sign ? intPart.slice(1) : intPart;
        const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        s = sign + grouped + (fracPart !== undefined ? "." + fracPart : "");
      }
      return s;
    };
    for (const id of ids) {
      const colType = table.columns[id]!.type;
      const values = table.rows.map(r => r[id]!);
      const nonNull = values.filter(v => v !== null);
      let valStr = "None";
      if (metricOp === "type") valStr = colType;
      else if (metricOp === "nulls") valStr = nonNull.length !== values.length ? "True" : "False";
      else if (metricOp === "nonnulls") valStr = String(nonNull.length);
      else if (metricOp === "unique") {
        const seen = new Set(values.map(v => v === null ? "null" : typeof v === "object" && v.kind === "decimal" ? "d:" + Decimal.parse(v.value).normalized().toString() : typeof v + ":" + pythonValueText(v)));
        valStr = String(seen.size);
      } else if (metricOp === "len" && colType === "Text") {
        let maxLen = 0;
        for (const v of nonNull) maxLen = Math.max(maxLen, Array.from(String(v)).length);
        valStr = fmtDec(Decimal.parse(String(maxLen)));
      } else if ((metricOp === "min" || metricOp === "max") && colType !== "Number") {
        if (nonNull.length > 0) {
          const strs = nonNull.map(v => typeof v === "object" && v !== null && "value" in v ? String(v.value) : pythonValueText(v));
          let best = strs[0]!;
          for (let k = 1; k < strs.length; k++) {
            if (metricOp === "min" ? strs[k]! < best : strs[k]! > best) best = strs[k]!;
          }
          valStr = best;
        }
      } else if ((metricOp === "min" || metricOp === "max" || metricOp === "sum" || metricOp === "mean" || metricOp === "median" || metricOp === "stdev" || metricOp === "max_precision") && colType === "Number") {
        if (nonNull.length > 0) {
          const decs = nonNull.map(v => Decimal.parse((v as { value: string }).value));
          if (metricOp === "min" || metricOp === "max") {
            let best = decs[0]!;
            for (let k = 1; k < decs.length; k++) {
              if (metricOp === "min" ? decs[k]!.compare(best) < 0 : decs[k]!.compare(best) > 0) best = decs[k]!;
            }
            valStr = fmtDec(best);
          } else if (metricOp === "max_precision") {
            let maxP = 0;
            for (const d of decs) {
              const norm = d.normalized();
              if (!norm.special && -norm.exponent > maxP) maxP = -norm.exponent;
            }
            valStr = fmtDec(Decimal.parse(String(maxP)));
          } else if (metricOp === "median") {
            const sorted = [...decs].sort((a, b) => a.compare(b));
            const mid = Math.floor(sorted.length / 2);
            const med = sorted.length % 2 === 1
              ? sorted[mid]!
              : sorted[mid - 1]!.add(sorted[mid]!).divide(Decimal.parse("2"));
            valStr = fmtDec(med);
          } else if (metricOp === "stdev") {
            if (decs.length >= 2) {
              const nums = decs.map(d => Number(d.toString()));
              if (nums.some(n => !Number.isFinite(n))) return undefined;
              const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
              const variance = nums.reduce((acc, n) => acc + (n - mean) * (n - mean), 0) / (nums.length - 1);
              valStr = fmtDec(Decimal.parse(String(Math.sqrt(variance))));
            }
          } else {
            let sum = Decimal.parse("0");
            for (const d of decs) sum = sum.add(d);
            valStr = fmtDec(metricOp === "sum" ? sum : sum.divide(Decimal.parse(String(decs.length))));
          }
        }
      } else {
        return undefined;
      }
      out += (ids.length === 1 ? "" : `${String(id + 1).padStart(3)}. ${table.headers[id]}: `) + valStr + "\n";
    }
    return out;
  } catch {
    return undefined;
  }
}


export function evalSyncIn2csv(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let formatSpec: string | undefined;
    let keySpec: string | undefined;
    let schemaSpec: string | undefined;
    let namesOnly = false;
    const filteredArgs: string[] = [];
    let posDone = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!posDone && a === "--") { posDone = true; filteredArgs.push(a); continue; }
      if (!posDone && a.startsWith("-") && a !== "-") {
        if (a === "-n" || a === "--names") { namesOnly = true; continue; }
        if (a === "-f" || a.startsWith("-f") || a === "--format" || a.startsWith("--format=")) {
          const v = a.startsWith("--format=") ? a.slice(9) : a.startsWith("-f=") ? a.slice(3) : a.length > 2 && a.startsWith("-f") ? a.slice(2) : opArgs[++i];
          if (!v) return undefined;
          formatSpec = v.toLowerCase();
          continue;
        }
        if (a === "-k" || a.startsWith("-k") || a === "--key" || a.startsWith("--key=")) {
          const v = a.startsWith("--key=") ? a.slice(6) : a.startsWith("-k=") ? a.slice(3) : a.length > 2 && a.startsWith("-k") ? a.slice(2) : opArgs[++i];
          if (!v) return undefined;
          keySpec = v;
          continue;
        }
        if (a === "-s" || a.startsWith("-s") || a === "--schema" || a.startsWith("--schema=")) {
          const v = a.startsWith("--schema=") ? a.slice(9) : a.startsWith("-s=") ? a.slice(3) : a.length > 2 && a.startsWith("-s") ? a.slice(2) : opArgs[++i];
          if (!v) return undefined;
          schemaSpec = v;
          continue;
        }
      }
      filteredArgs.push(a);
    }

    const opts = parseSyncCsvkitCommon(filteredArgs, "csvlook");
    if (!opts) return undefined;
    let sourceBytes = inBytes;
    if (opts.filePath !== undefined && opts.filePath !== "-") {
      if (!readFileSync) return undefined;
      sourceBytes = readFileSync(opts.filePath);
    }
    if (!sourceBytes || sourceBytes.byteLength > 16384) return undefined;
    let fmt = formatSpec;
    if (!fmt && opts.filePath && opts.filePath !== "-") {
      const lower = opts.filePath.toLowerCase();
      if (lower.endsWith(".json") || lower.endsWith(".js")) fmt = "json";
      else if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) fmt = "ndjson";
      else if (lower.endsWith(".csv") || lower.endsWith(".tsv")) fmt = "csv";
    }
    if (!fmt && schemaSpec !== undefined) fmt = "fixed";
    if (!fmt && keySpec !== undefined) fmt = "json";
    if (fmt === "fixed") {
      if (!schemaSpec || !readFileSync) return undefined;
      const schemaBytes = readFileSync(schemaSpec);
      if (!schemaBytes || schemaBytes.byteLength > 16384) return undefined;
      let schemaText = syncUtf8Decoder.decode(schemaBytes);
      if (schemaText.charCodeAt(0) === 0xfeff) schemaText = schemaText.slice(1);
      const schemaRows = Array.from(readCsv(schemaText, { delimiter: ",", quotechar: "\"", doublequote: true }), record => record.cells);
      if (schemaRows.length < 2) return undefined;
      const sHead = schemaRows[0]!;
      const colIdx = sHead.indexOf("column");
      const startIdx = sHead.indexOf("start");
      const lenIdx = sHead.indexOf("length");
      if (colIdx < 0 || startIdx < 0 || lenIdx < 0) return undefined;
      let oneBased: boolean | undefined;
      const fields: { name: string; start: number; length: number }[] = [];
      for (let r = 1; r < schemaRows.length; r++) {
        const row = schemaRows[r]!;
        if (row.length === 0 || (row.length === 1 && row[0] === "")) continue;
        const stNum = Number(row[startIdx]);
        const lnNum = Number(row[lenIdx]);
        if (!Number.isSafeInteger(stNum) || !Number.isSafeInteger(lnNum) || stNum < 0 || lnNum < 0) return undefined;
        oneBased ??= stNum === 1;
        fields.push({ name: row[colIdx]!, start: stNum - (oneBased ? 1 : 0), length: lnNum });
      }
      let inText = syncUtf8Decoder.decode(sourceBytes);
      if (inText.charCodeAt(0) === 0xfeff) inText = inText.slice(1);
      const rawLines = inText.split(/\r?\n/);
      if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
      const outDialect: CsvDialect = { delimiter: ",", quotechar: "\"", doublequote: true, lineterminator: "\n" };
      let out = opts.addBom ? "\ufeff" : "";
      out += writeCsvRow(fields.map(f => f.name), outDialect);
      for (let idx = opts.skipLines; idx < rawLines.length; idx++) {
        const chars = Array.from(rawLines[idx]!);
        const cells = fields.map(f => chars.slice(f.start, f.start + f.length).join("").trim());
        out += writeCsvRow(cells, outDialect);
      }
      return out;
    }
    if (namesOnly) {
      if (fmt !== "json") return undefined;
      let text = syncUtf8Decoder.decode(sourceBytes);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const root = JSON.parse(text);
      if (!root || typeof root !== "object" || Array.isArray(root)) return undefined;
      return Object.keys(root as Record<string, unknown>).map(k => k + "\n").join("");
    }
    if (fmt === "csv") {
      const table = loadSyncTypedTable(inBytes, opts, readFileSync);
      if (!table) return undefined;
      const outDialect: CsvDialect = { delimiter: ",", quotechar: "\"", doublequote: true, lineterminator: "\n" };
      let out = opts.addBom ? "\ufeff" : "";
      out += writeCsvRow(table.headers, outDialect);
      for (const row of table.rows) {
        out += writeCsvRow(
          row.map(v => (v === null ? "" : typeof v === "object" && v.kind === "datetime" ? v.value.replace(" ", "T") : pythonValueText(v))),
          outDialect,
        );
      }
      return out;
    }
    if (fmt !== "json" && fmt !== "ndjson") return undefined;
    if (fmt === "ndjson" && keySpec !== undefined) return undefined;
    let text = syncUtf8Decoder.decode(sourceBytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let parsedItems: unknown[];
    if (fmt === "ndjson") {
      parsedItems = [];
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        parsedItems.push(JSON.parse(trimmed));
      }
    } else {
      let root = JSON.parse(text);
      if (root && typeof root === "object" && !Array.isArray(root)) {
        if (!keySpec || !(keySpec in (root as Record<string, unknown>))) return undefined;
        root = (root as Record<string, unknown>)[keySpec];
      }
      if (!Array.isArray(root)) return undefined;
      parsedItems = root;
    }
    const headers: string[] = [];
    const known = new Set<string>();
    const rawMaps: Map<string, string | null>[] = [];
    const flatten = (val: unknown, path: string, row: Map<string, string | null>): void => {
      if (val !== null && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let idx = 0; idx < val.length; idx++) flatten(val[idx], path + String(idx) + "/", row);
        } else {
          for (const [k, child] of Object.entries(val as Record<string, unknown>)) flatten(child, path + k + "/", row);
        }
        return;
      }
      let start = 0;
      let end = path.length;
      while (path[start] === "/") start++;
      while (end > start && path[end - 1] === "/") end--;
      const name = path.slice(start, end);
      if (!name) throw new Error("empty header");
      const cell = val === null || val === undefined ? null : typeof val === "boolean" ? (val ? "True" : "False") : String(val);
      row.set(name, cell);
    };
    for (const item of parsedItems) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
      const row = new Map<string, string | null>();
      flatten(item, "", row);
      for (const name of row.keys()) {
        if (!known.has(name)) {
          known.add(name);
          headers.push(name);
        }
      }
      rawMaps.push(row);
    }
    if (headers.length === 0) return undefined;
    const stringRows = rawMaps.map((m, rIdx) => {
      const cells = headers.map(h => m.get(h) ?? "");
      return opts.lineNumbers ? [String(rIdx + 1), ...cells] : cells;
    });
    const finalHeaders = opts.lineNumbers ? ["line_number", ...headers] : headers;
    const inferenceOpts: InferenceOptions = {
      now: Date.now(),
      timezone: "UTC",
      noInference: opts.noInference,
      numberTextOnly: false,
      blanks: opts.blanks,
      nullValues: [],
      noLeadingZeroes: opts.noLeadingZeroes,
      maxDecimalDigits: Infinity,
      maxDecimalExponent: Infinity,
    };
    const table = inferTable(finalHeaders, stringRows, inferenceOpts);
    const outDialect: CsvDialect = { delimiter: ",", quotechar: "\"", doublequote: true, lineterminator: "\n" };
    let out = opts.addBom ? "\ufeff" : "";
    out += writeCsvRow(table.headers, outDialect);
    for (const row of table.rows) {
      out += writeCsvRow(
        row.map(v => (v === null ? "" : typeof v === "object" && v.kind === "datetime" ? v.value.replace(" ", "T") : pythonValueText(v))),
        outDialect,
      );
    }
    return out;
  } catch {
    return undefined;
  }
}

export function evalSyncCsvstack(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let groupsSpec: string | undefined;
    let groupName = "group";
    let groupByFilenames = false;
    let noHeaderRow = false;
    let lineNumbers = false;
    let addBom = false;
    let delimiter = ",";
    let tabs = false;
    const files: string[] = [];
    let posDone = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!posDone && a === "--") { posDone = true; continue; }
      if (!posDone && a.startsWith("-") && a !== "-") {
        if (a === "-H" || a === "--no-header-row") { noHeaderRow = true; continue; }
        if (a === "-l" || a === "--linenumbers") { lineNumbers = true; continue; }
        if (a === "--add-bom") { addBom = true; continue; }
        if (a === "-t" || a === "--tabs") { tabs = true; continue; }
        if (a === "-d" || a === "--delimiter" || a.startsWith("--delimiter=")) {
          const v = a.startsWith("--delimiter=") ? a.slice(12) : opArgs[++i];
          if (!v || Array.from(v).length !== 1) return undefined;
          delimiter = v;
          continue;
        }
        if (a === "--filenames") { groupByFilenames = true; continue; }
        if (a === "-g" || a === "--groups") {
          const v = opArgs[++i];
          if (v === undefined) return undefined;
          groupsSpec = v;
          continue;
        }
        if (a === "-n" || a === "--group-name") {
          const v = opArgs[++i];
          if (v === undefined) return undefined;
          groupName = v;
          continue;
        }
        return undefined;
      }
      files.push(a);
    }
    if (files.length === 0) files.push("-");
    if (noHeaderRow) return undefined;
    const groups = groupsSpec !== undefined && !groupByFilenames ? groupsSpec.split(",") : undefined;
    if (groups && groups.length !== files.length) return undefined;
    const grouped = groupsSpec !== undefined || groupByFilenames;
    const parsedFiles: { group: string; headers: string[]; rows: string[][] }[] = [];
    const unionHeaders: string[] = [];
    const seen = new Set<string>();
    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx]!;
      const bytes = f === "-" ? inBytes : readFileSync ? readFileSync(f) : undefined;
      if (!bytes || bytes.byteLength > 16384) return undefined;
      let text = syncUtf8Decoder.decode(bytes);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const recs = [...readCsv(text, { delimiter: tabs ? "\t" : delimiter, quotechar: "\"", doublequote: true, skipinitialspace: false })];
      const hdr = recs[0] ? recs[0].cells.map(c => pythonValueText(c)) : [];
      for (const h of hdr) {
        if (!seen.has(h)) {
          seen.add(h);
          unionHeaders.push(h);
        }
      }
      const groupVal = groups ? groups[idx]! : f.split("/").at(-1)!;
      parsedFiles.push({
        group: groupVal,
        headers: hdr,
        rows: recs.slice(1).map(r => r.cells.map(c => pythonValueText(c))),
      });
    }
    const outHeaders = grouped ? [groupName, ...unionHeaders] : [...unionHeaders];
    const outDialect: CsvDialect = { delimiter: ",", quotechar: "\"", doublequote: true, lineterminator: "\n" };
    let out = addBom ? "\ufeff" : "";
    out += writeCsvRow(lineNumbers ? ["line_number", ...outHeaders] : outHeaders, outDialect);
    let lineNum = 1;
    for (const pf of parsedFiles) {
      for (const r of pf.rows) {
        const rowMap = new Map<string, string>();
        for (let c = 0; c < pf.headers.length; c++) rowMap.set(pf.headers[c]!, r[c] ?? "");
        const cells = unionHeaders.map(h => rowMap.get(h) ?? "");
        if (grouped) cells.unshift(pf.group);
        if (lineNumbers) cells.unshift(String(lineNum++));
        out += writeCsvRow(cells, outDialect);
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

export function evalSyncCsvjoin(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    let columnsSpec: string | undefined;
    let joinMode: "inner" | "left" | "right" | "outer" = "inner";
    let noInference = false;
    let addBom = false;
    let delimiter: string | undefined;
    let tabs = false;
    const files: string[] = [];
    let posDone = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!posDone && a === "--") { posDone = true; continue; }
      if (!posDone && a.startsWith("-") && a !== "-") {
        if (a === "--left") { joinMode = "left"; continue; }
        if (a === "--right") { joinMode = "right"; continue; }
        if (a === "--outer") { joinMode = "outer"; continue; }
        if (a === "-I" || a === "--no-inference") { noInference = true; continue; }
        if (a === "--add-bom") { addBom = true; continue; }
        if (a === "-t" || a === "--tabs") { tabs = true; continue; }
        if (a === "-d" || a === "--delimiter" || a.startsWith("--delimiter=")) {
          const v = a.startsWith("--delimiter=") ? a.slice(12) : opArgs[++i];
          if (!v || Array.from(v).length !== 1) return undefined;
          delimiter = v;
          continue;
        }
        if (a === "-c" || a === "--columns") {
          const v = opArgs[++i];
          if (v === undefined) return undefined;
          columnsSpec = v;
          continue;
        }
        return undefined;
      }
      files.push(a);
    }
    if (files.length !== 2) return undefined;
    const leftOpts: ParsedSyncCsvkitOptions = {
      ...(delimiter === undefined ? {} : { delimiter }), tabs, noDoublequote: false, skipInitialSpace: false, noHeaderRow: false,
      skipLines: 0, lineNumbers: false, addBom: false, noInference, blanks: false,
      noLeadingZeroes: false, sniffLimit: 1024, noNumberEllipsis: false,
      indent: null, key: null, streamOutput: false, filePath: files[0]!,
    };
    const rightOpts: ParsedSyncCsvkitOptions = { ...leftOpts, filePath: files[1]! };
    const leftTable = loadSyncTypedTable(inBytes, leftOpts, readFileSync);
    const rightTable = loadSyncTypedTable(inBytes, rightOpts, readFileSync);
    if (!leftTable || !rightTable) return undefined;
    if (!columnsSpec) {
      if (joinMode !== "inner") return undefined;
      const outHeaders = [
        ...leftTable.headers,
        ...rightTable.headers.map(h => (leftTable.headers.includes(h) ? h + "2" : h)),
      ];
      if (new Set(outHeaders).size !== outHeaders.length) return undefined;
      const maxRows = Math.max(leftTable.rows.length, rightTable.rows.length);
      const outDialect: CsvDialect = { delimiter: ",", quotechar: "\"", doublequote: true, lineterminator: "\n" };
      let out = addBom ? "\ufeff" : "";
      out += writeCsvRow(outHeaders, outDialect);
      for (let r = 0; r < maxRows; r++) {
        const lRow = leftTable.rows[r] ?? leftTable.headers.map(() => null);
        const rRow = rightTable.rows[r] ?? rightTable.headers.map(() => null);
        out += writeCsvRow(
          [...lRow, ...rRow].map(v => (v === null ? "" : typeof v === "object" && v.kind === "datetime" ? v.value.replace(" ", "T") : pythonValueText(v))),
          outDialect,
        );
      }
      return out;
    }
    const colParts = columnsSpec.split(",");
    if (colParts.length !== 1 && colParts.length !== 2) return undefined;
    const leftKey = matchColumnIdentifier(leftTable.headers, colParts[0]!, 1);
    const rightKey = matchColumnIdentifier(rightTable.headers, colParts[1] ?? colParts[0]!, 1);
    const full = joinMode === "outer" || joinMode === "right";
    const inner = joinMode === "inner";
    const keyVal = (v: TableValue): string => {
      if (v === null) return "null";
      if (typeof v === "string") return "text:" + v;
      if (typeof v === "boolean") return v ? "number:1:0" : "number:0";
      if (v.kind === "decimal") {
        const d = Decimal.parse(v.value).normalized();
        return "number:" + d.toString();
      }
      return "other:" + pythonValueText(v);
    };
    const includedRight = rightTable.headers.map((_, idx) => idx).filter(idx => full || idx !== rightKey);
    const outHeaders = [
      ...leftTable.headers,
      ...includedRight.map(idx => (leftTable.headers.includes(rightTable.headers[idx]!) ? rightTable.headers[idx]! + "2" : rightTable.headers[idx]!)),
    ];
    if (new Set(outHeaders).size !== outHeaders.length) return undefined;
    const rightHash = new Map<string, (readonly TableValue[])[]>();
    const rightKeys: string[] = [];
    for (const row of rightTable.rows) {
      const k = keyVal(row[rightKey]!);
      rightKeys.push(k);
      const list = rightHash.get(k);
      if (list) list.push(row);
      else rightHash.set(k, [row]);
    }
    const joinedRows: TableValue[][] = [];
    const seenKeys = new Set<string>();
    for (const lRow of leftTable.rows) {
      const k = keyVal(lRow[leftKey]!);
      const matches = k === "null" ? undefined : rightHash.get(k);
      if (matches) {
        seenKeys.add(k);
        for (const rRow of matches) {
          joinedRows.push([...lRow, ...includedRight.map(idx => rRow[idx]!)]);
        }
      } else if (!inner && joinMode !== "right") {
        joinedRows.push([...lRow, ...includedRight.map(() => null)]);
      }
    }
    if (full) {
      for (let i = 0; i < rightTable.rows.length; i++) {
        const k = rightKeys[i]!;
        if (k === "null" || !seenKeys.has(k)) {
          const rRow = rightTable.rows[i]!;
          joinedRows.push([...leftTable.headers.map(() => null), ...includedRight.map(idx => rRow[idx]!)]);
        }
      }
    }
    const outDialect: CsvDialect = { delimiter: ",", quotechar: "\"", doublequote: true, lineterminator: "\n" };
    let out = addBom ? "\ufeff" : "";
    out += writeCsvRow(outHeaders, outDialect);
    for (const row of joinedRows) {
      out += writeCsvRow(
        row.map(v => (v === null ? "" : typeof v === "object" && v.kind === "datetime" ? v.value.replace(" ", "T") : pythonValueText(v))),
        outDialect,
      );
    }
    return out;
  } catch {
    return undefined;
  }
}
