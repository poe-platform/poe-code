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
    maxInputBytes: 8 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024,
    maxDiagnosticBytes: 65_536,
    maxRecordBytes: 64 * 1024, maxChunkBytes: 1024 * 1024,
    maxRows: 50_000, maxCells: 250_000, maxFields: 1024, maxFiles: 64,
    maxSteps: 4_000_000, maxArgumentBytes: 65_536, maxWidth: 65_536,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 64 * 1024 * 1024) {
      throw new RangeError(`Invalid column limit: ${name} (expected integer 1..67108864)`);
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
  readonly across: boolean;
  readonly separator: Set<string> | undefined;
  readonly outputSeparator: string;
  readonly width: number;
  readonly files: readonly string[];
  readonly help: boolean;
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
  let table = false, across = false, literal = false, help = false;
  let separator: Set<string> | undefined, outputSeparator = "  ", width = 80, outputSet = false;
  const files: string[] = [];
  const setValue = (option: string, value: string): void => {
    if (option === "s") {
      if (!value) usage("input separator must not be empty");
      separator = new Set(value);
    } else if (option === "o") { outputSeparator = value; outputSet = true; }
    else {
      if (!value || value.length > 8) usage("output width must be a positive bounded decimal integer");
      for (const character of value) if (character < "0" || character > "9") usage("invalid output width");
      width = Number(value);
      if (width < 1 || width > limits.maxWidth) usage("output width exceeds configured width limit or is zero");
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
      if (token === "--fillrows") { across = true; continue; }
      if (token === "--help") { help = true; continue; }
      const equals = token.indexOf("="), name = equals < 0 ? token : token.slice(0, equals);
      const option = name === "--separator" || name === "--input-separator" ? "s"
        : name === "--output-separator" ? "o" : name === "--output-width" ? "c" : undefined;
      if (!option) usage(`unsupported option: ${token}`);
      let value: string;
      [value, index] = argument(args, index, equals < 0 ? undefined : token.slice(equals + 1), name);
      setValue(option, value);
      continue;
    }
    for (let offset = 1; offset < token.length; offset++) {
      const option = token[offset]!;
      if (option === "t") table = true;
      else if (option === "x") across = true;
      else if (option === "h") help = true;
      else if (option === "s" || option === "o" || option === "c") {
        let value: string;
        [value, index] = argument(args, index, offset + 1 < token.length ? token.slice(offset + 1) : undefined, `-${option}`);
        setValue(option, value);
        break;
      } else usage(`unsupported option: -${option}`);
    }
  }
  if (table && across) usage("-x/--fillrows cannot be combined with table mode");
  if (!table && (separator !== undefined || outputSet)) usage("input/output separators require -t/--table");
  if (!table && width > limits.maxWidth) width = limits.maxWidth;
  return { table, across, separator, outputSeparator, width, files: files.length ? files : ["-"], help };
}

export const helpText = `Usage: column [-t] [-s characters] [-o string] [-c width] [-x] [file ...]
  -t, --table              align fields; default ASCII whitespace splitting
  -s, --separator          table input delimiter characters; preserve empty fields
      --input-separator   alias for --separator
  -o, --output-separator   table output separator (default two spaces)
  -c, --output-width       positive fill width (default 80); no table truncation
  -x, --fillrows           fill across rows instead of down columns
  -h, --help              show this supported profile
  --                      end options; - reads shared stdin
Strict UTF-8; deterministic scalar widths; retained tabs expand at 8-column stops.
No terminal/locale detection, ANSI controls, wrapping, headers, JSON, or tree mode.
`;
