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
    name: "csvkit",
    setup(host) {
      for (const command of commands) {
        if (command.fallback) {
          if (!host.commands.has(command.name)) host.commands.register(command);
        } else {
          host.commands.register(command, { replace });
        }
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
      if (a === "-d" || a === "--delimiter") {
        const v = opArgs[++i];
        if (!v || Array.from(v).length !== 1) return undefined;
        res.delimiter = v;
        continue;
      }
      if (a === "-q" || a === "--quotechar") {
        const v = opArgs[++i];
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
      if (a === "-K" || a === "--skip-lines") {
        const v = opArgs[++i];
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
        if (a === "-i" || a === "--indent") {
          const v = opArgs[++i];
          if (v === undefined || !/^[0-9]+$/.test(v)) return undefined;
          res.indent = Number(v);
          continue;
        }
        if (a === "-k" || a === "--key") {
          const v = opArgs[++i];
          if (v === undefined) return undefined;
          res.key = v;
          continue;
        }
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
        if (a === "-c" || a === "--columns") {
          const v = opArgs[++i];
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
        if (a === "-D" || a === "--out-delimiter") {
          const v = opArgs[++i];
          if (!v || Array.from(v).length !== 1) return undefined;
          outDelimiter = v;
          continue;
        }
        if (a === "-Q" || a === "--out-quotechar") {
          const v = opArgs[++i];
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
        if (a === "-M" || a === "--out-lineterminator") {
          const v = opArgs[++i];
          if (v === undefined) return undefined;
          outLineterminator = v;
          continue;
        }
        if (a === "-U" || a === "--out-quoting") {
          const v = opArgs[++i];
          if (v === undefined || !/^[013]$/.test(v)) return undefined;
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
    let inDialect: CsvDialect = {
      delimiter: opts.tabs ? "\t" : opts.delimiter,
      quotechar: opts.quotechar,
      escapechar: opts.escapechar,
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
    const filteredArgs: string[] = [];
    let posDone = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!posDone && a === "--") { posDone = true; filteredArgs.push(a); continue; }
      if (!posDone && a.startsWith("-") && a !== "-") {
        if (a === "--count") { countOnly = true; continue; }
        if (a === "-n" || a === "--names") { namesOnly = true; continue; }
        if (a === "--zero") { zeroBased = true; continue; }
      }
      filteredArgs.push(a);
    }
    if (!countOnly && !namesOnly) return undefined;
    if (countOnly && namesOnly) return undefined;
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
    return out + `${table.rows.length}\n`;
  } catch {
    return undefined;
  }
}
