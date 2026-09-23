import { FsError } from "../../contracts/index.js";
import { argument, settings as tableSettings, type TableTextLimits } from "../table-text/internal.js";

export interface ColumnLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxRecordBytes: number;
  readonly maxChunkBytes: number;
  readonly maxRows: number;
  readonly maxCells: number;
  readonly maxFields: number;
  readonly maxFiles: number;
  readonly maxSteps: number;
  readonly maxArgumentBytes: number;
  readonly maxWidth: number;
}

export interface ColumnCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<ColumnLimits>;
}

export function settings(options: ColumnCommandsOptions): ColumnLimits {
  const limits: ColumnLimits = {
    maxInputBytes: Infinity, maxOutputBytes: Infinity,
    maxDiagnosticBytes: Infinity,
    maxRecordBytes: Infinity, maxChunkBytes: Infinity,
    maxRows: Infinity, maxCells: Infinity, maxFields: Infinity, maxFiles: Infinity,
    maxSteps: Infinity, maxArgumentBytes: Infinity, maxWidth: Infinity,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) {
      throw new RangeError(`Invalid column limit: ${name}`);
    }
  }
  return Object.freeze(limits);
}

export function readerSettings(limits: ColumnLimits): TableTextLimits {
  return tableSettings({ limits: {
    maxInputBytes: limits.maxInputBytes, maxOutputBytes: limits.maxOutputBytes,
    maxRecordBytes: limits.maxRecordBytes, maxChunkBytes: limits.maxChunkBytes,
    maxGroupBytes: limits.maxInputBytes, maxGroupRecords: limits.maxRows,
    maxFields: limits.maxFields, maxFiles: limits.maxFiles,
    maxSteps: limits.maxSteps, maxArgumentBytes: limits.maxArgumentBytes,
  } });
}

export interface ParsedOptions {
  readonly table: boolean;
  readonly json: boolean;
  readonly names: readonly string[];
  readonly tableName: string;
  readonly across: boolean;
  readonly separator: Set<string> | undefined;
  readonly outputSeparator: string;
  readonly width: number;
  readonly files: readonly string[];
  readonly help: boolean;
  readonly noHeadings: boolean;
  readonly keepEmpty: boolean;
  readonly maxout: boolean;
  readonly headerRepeat: boolean;
  readonly columnLimit: number;
  readonly order: string;
  readonly selectors: Readonly<Record<"hide" | "right" | "truncate" | "wrap" | "noextreme", string>>;
  readonly definitions: readonly ColumnDefinition[];
}

export interface ColumnDefinition {
  readonly name: string;
  readonly named: boolean;
  readonly flags: readonly string[];
}

export function usage(message: string): never {
  throw new FsError("EINVAL", { message });
}

export function parse(args: readonly string[], limits: ColumnLimits): ParsedOptions {
  if (args.length > limits.maxArgumentBytes) usage("argument count limit exceeded");
  let argumentBytes = 0;
  for (const token of args) {
    if (token.length > limits.maxArgumentBytes - argumentBytes) usage("argument limit exceeded");
    argumentBytes += Buffer.byteLength(token);
    if (argumentBytes > limits.maxArgumentBytes) usage("argument limit exceeded");
  }
  let table = false, json = false, across = false, literal = false, help = false;
  let names: string[] = [], tableName = "table";
  let noHeadings = false, keepEmpty = false, maxout = false, headerRepeat = false, columnLimit = 0, order = "";
  const selectors = { hide: "", right: "", truncate: "", wrap: "", noextreme: "" };
  const definitions: ColumnDefinition[] = [];
  let separator: Set<string> | undefined, outputSeparator = "  ", width = 80, outputSet = false;
  const files: string[] = [];
  const setValue = (option: string, value: string): void => {
    if (option === "s") {
      if (!value) usage("input separator must not be empty");
      separator = new Set(value);
    } else if (option === "o") { outputSeparator = value; outputSet = true; }
    else if (option === "N") {
      names = value.split(",");
      if (names.length > limits.maxFields) usage("column names exceed configured field limit");
      if (names.some(name => !name || name.includes("\0"))) usage("column names must be nonempty and contain no NUL");
    } else if (option === "n") {
      if (!value || value.includes("\0")) usage("table name must be nonempty and contain no NUL");
      tableName = value;
    } else if (option === "O") order = value;
    else if (option === "H") selectors.hide = value;
    else if (option === "R") selectors.right = value;
    else if (option === "T") selectors.truncate = value;
    else if (option === "W") selectors.wrap = value;
    else if (option === "E") selectors.noextreme = value;
    else if (option === "l") {
      if (!value || Array.from(value).some(character => character < "0" || character > "9")) usage("invalid columns limit");
      columnLimit = Number(value);
      if (!Number.isSafeInteger(columnLimit) || columnLimit < 1 || columnLimit > limits.maxFields) usage("columns limit exceeds configured field limit or is zero");
    } else if (option === "C") {
      if (definitions.length >= limits.maxFields) usage("column definitions exceed configured field limit");
      let name = "", named = false;
      const flags: string[] = [];
      for (const property of value.split(",")) {
        if (property.startsWith("name=")) { name = property.slice(5); named = true; }
        else if (property === "hidden") flags.push("hide");
        else if (property === "hide") continue; // util-linux 2.39.3 accepts this spelling without setting hidden.
        else if (property === "noextreme" || property === "noextremes" || property === "strictwidth") flags.push("strictwidth");
        else if (["right", "trunc", "wrap"].includes(property)) flags.push(property);
        else usage(`unsupported column property: ${property}`);
      }
      definitions.push({ name, named, flags });
    }
    else {
      if (!value) usage("output width must be a positive bounded decimal integer");
      for (const character of value) if (character < "0" || character > "9") usage("invalid output width");
      width = Number(value);
      if (!Number.isSafeInteger(width) || width < 1 || width > limits.maxWidth) usage("output width exceeds configured width limit or is zero");
    }
  };
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (literal || token === "-" || !token.startsWith("-")) {
      if (files.length >= limits.maxFiles) usage("file limit exceeded");
      if (token.includes("\0")) usage("file operand contains NUL");
      files.push(token);
      continue;
    }
    if (token === "--") { literal = true; continue; }
    if (token.startsWith("--")) {
      if (token === "--table") { table = true; continue; }
      if (token === "--json") { json = true; table = true; continue; }
      if (token === "--fillrows") { across = true; continue; }
      if (token === "--help") { help = true; continue; }
      if (token === "--table-noheadings") { noHeadings = true; continue; }
      if (token === "--keep-empty-lines") { keepEmpty = true; continue; }
      if (token === "--table-maxout") { maxout = true; continue; }
      if (token === "--table-header-repeat") { headerRepeat = true; continue; }
      const equals = token.indexOf("="), name = equals < 0 ? token : token.slice(0, equals);
      const option = name === "--separator" || name === "--input-separator" ? "s"
        : name === "--output-separator" ? "o" : name === "--output-width" ? "c"
        : name === "--table-columns" ? "N" : name === "--table-name" ? "n"
        : name === "--table-order" ? "O" : name === "--table-hide" ? "H"
        : name === "--table-right" ? "R" : name === "--table-truncate" ? "T"
        : name === "--table-wrap" ? "W" : name === "--table-noextreme" ? "E"
        : name === "--table-columns-limit" ? "l" : name === "--table-column" ? "C" : undefined;
      if (!option) usage(`unsupported option: ${token}`);
      let value: string;
      [value, index] = argument(args, index, equals < 0 ? undefined : token.slice(equals + 1), name);
      setValue(option, value);
      continue;
    }
    for (let offset = 1; offset < token.length; offset++) {
      const option = token[offset]!;
      if (option === "t") table = true;
      else if (option === "J") { json = true; table = true; }
      else if (option === "x") across = true;
      else if (option === "h") help = true;
      else if (option === "d") noHeadings = true;
      else if (option === "L") keepEmpty = true;
      else if (option === "m") maxout = true;
      else if (option === "e") headerRepeat = true;
      else if (["s", "o", "c", "N", "n", "O", "H", "R", "T", "W", "E", "l", "C"].includes(option)) {
        let value: string;
        [value, index] = argument(args, index, offset + 1 < token.length ? token.slice(offset + 1) : undefined, `-${option}`);
        setValue(option, value);
        break;
      } else usage(`unsupported option: -${option}`);
    }
  }
  if (table && across) usage("-x/--fillrows cannot be combined with table mode");
  if (definitions.length && names.length) usage("--table-columns and --table-column are mutually exclusive");
  if (definitions.length) names = definitions.map(definition => definition.name);
  if (!table && (names.length || order || tableName !== "table" || Object.values(selectors).some(value => value))) usage("table options require -t/--table");
  if (json && !names.length && !help) usage("JSON output requires --table-columns");
  if (!table && (separator !== undefined || outputSet)) usage("input/output separators require -t/--table");
  if (!table && width > limits.maxWidth) width = limits.maxWidth;
  return { table, json, names, tableName, across, separator, outputSeparator, width, files: files.length ? files : ["-"], help,
    noHeadings, keepEmpty, maxout, headerRepeat, columnLimit, order, selectors, definitions };
}

export const helpText = `Usage: column [-t] [-s characters] [-o string] [-c width] [-x] [file ...]
  -t, --table              align fields; default ASCII whitespace splitting
  -J, --json               JSON table output (requires named columns)
  -N, --table-columns      comma-separated column names for table mode
  -n, --table-name         JSON table name (default table)
  -C, --table-column       repeatable name=NAME column definitions and attributes
  -O, --table-order        comma-separated names or numbers in output order
  -H, --table-hide         columns to hide; - selects unnamed columns
  -R, --table-right        columns to align right
  -T, --table-truncate     columns to truncate to the output width
  -W, --table-wrap         columns to wrap to the output width
  -E, --table-noextreme    columns whose long cells may exceed their layout width
  -l, --table-columns-limit  keep the unsplit remainder in the last input column
  -d, --table-noheadings   suppress table headings
  -e, --table-header-repeat  repeat headings every 24 output lines
  -m, --table-maxout       expand table padding to the output width
  -L, --keep-empty-lines   retain empty input records
  -s, --separator          table input delimiter characters; preserve empty fields
      --input-separator   alias for --separator
  -o, --output-separator   table output separator (default two spaces)
  -c, --output-width       positive layout width (default 80)
  -x, --fillrows           fill across rows instead of down columns
  -h, --help              show this supported profile
  --                      end options; - reads shared stdin
Strict UTF-8; deterministic scalar widths; retained tabs expand at 8-column stops.
No terminal/locale detection, ANSI controls, colors, or tree mode.
`;
