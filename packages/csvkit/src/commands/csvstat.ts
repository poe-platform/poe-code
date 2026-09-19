// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { printNames, parseColumnIdentifiers } from "../columns.js";
import { readTable, type TableValue, type ColumnType } from "../table/index.js";
import { Decimal, DecimalTrap } from "../types/decimal.js";
import { decimalPercentiles, sampleVariance } from "../types/metrics.js";
import { temporalOrder } from "../types/temporal.js";
import { pythonValueText, type CsvWriteCell } from "../csv.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { emit, type JsonValue } from "../operations/json-table.js";

const operations = [
  ["type", "Type of data: "], ["nulls", "Contains null values: "],
  ["nonnulls", "Non-null values: "], ["unique", "Unique values: "],
  ["min", "Smallest value: "], ["max", "Largest value: "],
  ["sum", "Sum: "], ["mean", "Mean: "], ["median", "Median: "],
  ["stdev", "StDev: "], ["len", "Longest value: "],
  ["maxprecision", "Most decimal places: "], ["freq", "Most common values: "]
] as const;
type Operation = typeof operations[number][0];
interface Frequency { readonly value: TableValue; count: number }
type Stat = TableValue | number | readonly Frequency[];
class CalculationError extends Error {}

function text(value: CsvWriteCell): string { return value === null ? "None" : pythonValueText(value); }

/** Correctly rounded precision-28 Decimal sqrt, without a binary-float detour. */
function sqrt(value: Decimal, runtime: Runtime): Decimal {
  if (value.special === "NaN" || value.special === "Infinity" && !value.negative) return value;
  if (value.negative && value.coefficient !== 0n || value.special) throw new DecimalTrap("InvalidOperation");
  if (value.coefficient === 0n) return Decimal.parse((value.negative ? "-" : "") + "0e" + Math.floor(value.exponent / 2));
  const exponent = Math.floor((value.exponent + value.coefficient.toString().length - 1) / 2) - 27;
  const radicand = value.coefficient * 10n ** BigInt(value.exponent - 2 * exponent);
  let root = 10n ** BigInt(Math.ceil(radicand.toString().length / 2));
  while (true) {
    runtime.step();
    const next = (root + radicand / root) / 2n;
    if (next >= root) break;
    root = next;
  }
  const midpoint = (2n * root + 1n) ** 2n;
  if (4n * radicand > midpoint || 4n * radicand === midpoint && root % 2n !== 0n) root++;
  // Exact roots retain only the necessary digits (and the preferred exponent).
  let scale = exponent;
  if (root * root === radicand) while (root % 10n === 0n && scale < Math.floor(value.exponent / 2)) { runtime.step(); root /= 10n; scale++; }
  return Decimal.parse(root + "e" + scale).multiply(Decimal.parse("1"));
}

function compare(a: TableValue, b: TableValue, runtime: Runtime): number {
  runtime.step();
  if (typeof a !== "object" || !a || typeof b !== "object" || !b) throw new CalculationError("inapplicable ordering");
  if (a.kind === "decimal" && b.kind === "decimal") return Decimal.parse(a.value).compare(Decimal.parse(b.value));
  if (a.kind === "timedelta" && b.kind === "timedelta") return a.microseconds < b.microseconds ? -1 : a.microseconds > b.microseconds ? 1 : 0;
  if ((a.kind === "date" || a.kind === "datetime") && a.kind === b.kind) {
    const aware = (value: string): boolean => value.slice(19).includes("+") || value.slice(19).includes("-");
    if (a.kind === "datetime" && aware(a.value) !== aware(b.value)) throw new CalculationError("mixed datetime offsets");
    const x = temporalOrder(a.value); const y = temporalOrder(b.value);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  throw new CalculationError("inapplicable ordering");
}

function format(value: TableValue, runtime: Runtime): TableValue {
  if (typeof value !== "object" || !value || value.kind !== "decimal" || Decimal.parse(value.value).special) return value;
  let result = runtime.context.locale.formatNumber(value.value, runtime.context.locale.profile, String(runtime.options.decimal_format), !runtime.options.no_grouping_separator);
  while (result.endsWith("0")) { runtime.step(); result = result.slice(0, -1); }
  while (result.endsWith(".")) { runtime.step(); result = result.slice(0, -1); }
  return result;
}

/** Python hashing merges equal Decimals, retains the first spelling, and keeps NaNs distinct. */
function frequencies(values: readonly TableValue[], runtime: Runtime): Frequency[] {
  const counts = new Map<string, Frequency>();
  for (const [index, value] of values.entries()) {
    runtime.step();
    let key: string;
    if (typeof value === "object" && value) {
      if (value.kind === "decimal") {
        const decimal = Decimal.parse(value.value).normalized();
        key = decimal.special === "NaN" ? "nan:" + index : decimal.coefficient === 0n && !decimal.special ? "decimal:0" : "decimal:" + decimal.toString();
      } else if (value.kind === "timedelta") key = "duration:" + value.microseconds;
      else {
        const offset = value.kind === "datetime" && (value.value.slice(19).includes("+") || value.value.slice(19).includes("-")) ? "aware:" : "naive:";
        key = value.kind + ":" + offset + temporalOrder(value.value);
      }
    } else key = typeof value + ":" + value;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else { runtime.retain(96 + key.length * 2); counts.set(key, { value, count: 1 }); }
  }
  return [...counts.values()];
}

function calculate(op: Operation, type: ColumnType, values: readonly TableValue[], distinct: readonly Frequency[], runtime: Runtime): Stat {
  runtime.retain(64 + values.length * 16);
  const data = values.filter(value => { runtime.step(); return value !== null; });
  if (op === "type") return type;
  if (op === "nulls") return data.length !== values.length;
  if (op === "nonnulls") return data.length;
  if (op === "unique") return distinct.length;
  if (op === "freq") {
    const count = Number(runtime.options.freq_count || 5);
    return [...distinct].sort((a, b) => { runtime.step(); return b.count - a.count; }).slice(0, Math.max(0, count));
  }
  try {
    let result: TableValue = null;
    if (op === "len" && type === "Text") {
      let length = 0;
      for (const value of data) { let size = 0; for (const ignoredChar of String(value)) { runtime.step(); size++; } length = Math.max(length, size); }
      result = { kind: "decimal", value: String(length) };
    } else if (op === "maxprecision" && type === "Number") {
      let whole = 1; let places = 0;
      for (const value of data) {
        runtime.step();
        const spelling = (value as { value: string }).value;
        // Agate checks math.isnan/isinf before normalization, converting to float.
        if (!Number.isFinite(Number(spelling))) continue;
        const decimal = Decimal.parse(spelling).normalized();
        if (decimal.special) continue;
        whole = Math.max(whole, decimal.coefficient.toString().length + decimal.exponent);
        places = Math.max(places, -decimal.exponent);
      }
      return Math.min(places, 28 - whole);
    } else if ((op === "min" || op === "max") && ["Number", "Date", "DateTime", "TimeDelta"].includes(type)) {
      for (const value of data) if (result === null || (op === "min" ? compare(value, result, runtime) < 0 : compare(value, result, runtime) > 0)) result = value;
    } else if ((op === "sum" || op === "mean") && type === "TimeDelta") {
      let total = 0n;
      for (const value of data) {
        runtime.step(); total += (value as { microseconds: bigint }).microseconds;
        // datetime.sum traps at each intermediate timedelta addition.
        pythonValueText({ kind: "timedelta", microseconds: total });
      }
      if (op === "mean" && !data.length) return null;
      if (op === "mean") {
        const negative = total < 0n; const absolute = negative ? -total : total; const size = BigInt(data.length);
        let quotient = absolute / size; const remainder = absolute % size;
        if (remainder * 2n > size || remainder * 2n === size && quotient % 2n) quotient++;
        total = negative ? -quotient : quotient;
      }
      result = { kind: "timedelta", microseconds: total };
    } else if (type === "Number" && ["sum", "mean", "median", "stdev"].includes(op)) {
      const numbers = data.map(value => { runtime.step(); return Decimal.parse((value as { value: string }).value); });
      let decimal: Decimal;
      if (op === "median") {
        runtime.retain(4096 + numbers.length * 16);
        const median = decimalPercentiles(numbers, runtime.step)[50];
        if (!median) return null;
        decimal = median;
      } else if (op === "stdev") {
        const variance = sampleVariance(numbers, runtime.step);
        if (!variance) return null;
        decimal = sqrt(variance, runtime);
      } else {
        decimal = Decimal.parse("0");
        for (const number of numbers) { runtime.step(); decimal = decimal.add(number); }
        if (op !== "sum") {
          if (!numbers.length) return null;
          decimal = decimal.divide(Decimal.parse(String(numbers.length)));
        }
      }
      result = { kind: "decimal", value: decimal.toString() };
    }
    return runtime.options.json_output ? result : format(result, runtime);
  } catch (failure) {
    runtime.step();
    if (failure instanceof CsvkitBlocked) throw failure;
    // csvstat suppresses aggregation failures; host/budget/cancellation errors
    // remain observable instead of silently masquerading as inapplicability.
    if (failure instanceof DecimalTrap || failure instanceof CsvkitDiagnostic || failure instanceof CalculationError) return null;
    throw failure;
  }
}

async function statistics(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  if (o.names_only) return printNames(runtime);
  if (runtime.context.terminal.stdinIsTTY && !o.input_path) runtime.error("You must provide an input file or piped data.");
  const requested = operations.filter(([op]) => o[op + "_only"]);
  if (requested.length > 1) runtime.error("Only one operation argument may be specified (--mean, --median, etc).");
  for (const [option, label] of [["csv_output", "csv"], ["json_output", "json"], ["count_only", "count"]] as const) {
    if (requested.length && o[option]) runtime.error(`You may not specify --${label} and an operation (--mean, --median, etc) at the same time.`);
  }
  if (o.count_only) {
    let count = o.no_header_row ? 0 : -1;
    for await (const ignoredRecord of runtime.records()) count++;
    await runtime.write(`${count}\n`); return 0;
  }
  const table = await readTable(runtime, undefined, undefined, true);
  const ids = parseColumnIdentifiers(o.columns as string | null, table.headers, o.zero_based ? 0 : 1, undefined, runtime.step, true);
  const stats = new Map<number, Map<Operation, Stat>>();
  for (const id of ids) {
    runtime.retain(128 + table.rows.length * 32);
    const values = table.rows.map(row => { runtime.step(); return row[id]!; });
    const distinct = frequencies(values, runtime);
    const column = new Map<Operation, Stat>();
    for (const [op] of requested.length ? requested : operations) { runtime.step(); column.set(op, calculate(op, table.columns[id]!.type, values, distinct, runtime)); }
    stats.set(id, column);
    if (requested.length) {
      const op = requested[0]![0]; const stat = column.get(op)!;
      const output = op === "freq" ? "{ " + (stat as readonly Frequency[]).map(row => `"${text(row.value)}": ${row.count}`).join(", ") + " }" : text(stat as CsvWriteCell);
      await runtime.write((ids.length === 1 ? "" : `${String(id + 1).padStart(3)}. ${table.headers[id]}: `) + output + "\n");
    }
  }
  if (requested.length) return 0;
  if (o.csv_output) {
    await runtime.row(["column_id", "column_name", ...operations.map(([op]) => op)], {}, false);
    for (const id of ids) await runtime.row([id + 1, table.headers[id]!, ...operations.map(([op]) => {
      const value = stats.get(id)!.get(op)!;
      return op === "freq" ? (value as readonly Frequency[]).map(row => text(row.value)).join(", ") : value as CsvWriteCell;
    })], {}, false);
  } else if (o.json_output) {
    const jsonValue = (value: TableValue | number, integer = false): JsonValue => {
      if (typeof value === "number") return integer ? { token: String(value) } : value;
      if (typeof value !== "object" || !value) return value;
      if (value.kind === "decimal") return Number(value.value);
      if (value.kind === "timedelta") return Number(value.microseconds) / 1000000;
      return value.kind === "datetime" ? value.value.replace(" ", "T") : value.value;
    };
    const rows = ids.map(id => {
      runtime.step(); runtime.retain(1024);
      const row = new Map<string, JsonValue>([["column_id", { token: String(id + 1) }], ["column_name", table.headers[id]!]]);
      for (const [op, stat] of stats.get(id)!) {
        runtime.step();
        if (stat === null) continue;
        row.set(op, op === "freq" ? (stat as readonly Frequency[]).map(item => new Map<string, JsonValue>([["value", jsonValue(item.value)], ["count", { token: String(item.count) }]])) : jsonValue(stat as TableValue | number, true));
      }
      return row;
    });
    const indent = o.indent === null ? null : Math.max(0, Number(o.indent));
    if (indent !== null) { if (!Number.isSafeInteger(indent)) throw new CsvkitBlocked("JSON indentation budget"); runtime.retain(indent * 12); }
    await emit(rows, runtime, indent);
  } else {
    const width = Math.max(...operations.map(([, label]) => label.length));
    for (const id of ids) {
      await runtime.write(`${String(id + 1).padStart(3)}. "${table.headers[id]}"\n\n`);
      for (const [op, label] of operations) {
        const stat = stats.get(id)!.get(op)!;
        if (stat === null) continue;
        const padded = label.padEnd(width);
        if (op === "freq") {
          for (const [index, row] of (stat as readonly Frequency[]).entries()) {
            const value = table.columns[id]!.type === "Number" ? format(row.value, runtime) : row.value;
            await runtime.write(`\t${index ? " ".repeat(width) : padded} ${text(value)} (${row.count}x)\n`);
          }
        } else {
          let value = text(stat as CsvWriteCell);
          if (op === "nulls" && stat) value += " (excluded from calculations)";
          if (op === "len") value += " characters";
          await runtime.write(`\t${padded} ${value}\n`);
        }
      }
      await runtime.write("\n");
    }
    await runtime.write(`Row count: ${table.rows.length}\n`);
  }
  return 0;
}

export const csvstat = {
  execute: statistics,
  "name": "csvstat",
  "usage": "usage: csvstat [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [--csv] [--json] [-i INDENT] [-n]\n               [-c COLUMNS] [--type] [--nulls] [--non-nulls] [--unique]\n               [--min] [--max] [--sum] [--mean] [--median] [--stdev] [--len]\n               [--max-precision] [--freq] [--freq-count FREQ_COUNT] [--count]\n               [--decimal-format DECIMAL_FORMAT] [-G] [-y SNIFF_LIMIT] [-I]\n               [FILE]\n",
  "help": "usage: csvstat [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [--csv] [--json] [-i INDENT] [-n]\n               [-c COLUMNS] [--type] [--nulls] [--non-nulls] [--unique]\n               [--min] [--max] [--sum] [--mean] [--median] [--stdev] [--len]\n               [--max-precision] [--freq] [--freq-count FREQ_COUNT] [--count]\n               [--decimal-format DECIMAL_FORMAT] [-G] [-y SNIFF_LIMIT] [-I]\n               [FILE]\n\nPrint descriptive statistics for each column in a CSV file.\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -L, --locale LOCALE   Specify the locale (en_US) of any formatted numbers.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  --blanks              Do not convert \"\", \"na\", \"n/a\", \"none\", \"null\", \".\" to\n                        NULL.\n  --null-value NULL_VALUES [NULL_VALUES ...]\n                        Convert this value to NULL. --null-value can be\n                        specified multiple times.\n  --date-format DATE_FORMAT\n                        Specify a strptime date format string like \"%m/%d/%Y\".\n  --datetime-format DATETIME_FORMAT\n                        Specify a strptime datetime format string like\n                        \"%m/%d/%Y %I:%M %p\".\n  --no-leading-zeroes   Do not convert a numeric value with leading zeroes to\n                        a number.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  --csv                 Output results as a CSV table, rather than plain text.\n  --json                Output results as JSON text, rather than plain text.\n  -i, --indent INDENT   Indent the output JSON this many spaces. Disabled by\n                        default.\n  -n, --names           Display column names and indices from the input CSV\n                        and exit.\n  -c, --columns COLUMNS\n                        A comma-separated list of column indices, names or\n                        ranges to be examined, e.g. \"1,id,3-5\". Defaults to\n                        all columns.\n  --type                Only output data type.\n  --nulls               Only output whether columns contains nulls.\n  --non-nulls           Only output counts of non-null values.\n  --unique              Only output counts of unique values.\n  --min                 Only output smallest values.\n  --max                 Only output largest values.\n  --sum                 Only output sums.\n  --mean                Only output means.\n  --median              Only output medians.\n  --stdev               Only output standard deviations.\n  --len                 Only output the length of the longest values.\n  --max-precision       Only output the most decimal places.\n  --freq                Only output lists of frequent values.\n  --freq-count FREQ_COUNT\n                        The maximum number of frequent values to display.\n  --count               Only output total row count.\n  --decimal-format DECIMAL_FORMAT\n                        %-format specification for printing decimal numbers.\n                        Defaults to locale-specific formatting with \"%.3f\".\n  -G, --no-grouping-separator\n                        Do not use grouping separators in decimal numbers.\n  -y, --snifflimit SNIFF_LIMIT\n                        Limit CSV dialect sniffing to the specified number of\n                        bytes. Specify \"0\" to disable sniffing entirely, or\n                        \"-1\" to sniff the entire file.\n  -I, --no-inference    Disable type inference (and --locale, --date-format,\n                        --datetime-format, --no-leading-zeroes) when parsing\n                        the input.\n",
  "defaults": {},
  "actions": [
    {
      "optionStrings": [
        "-h",
        "--help"
      ],
      "dest": "help",
      "action": "_HelpAction",
      "nargs": 0,
      "default": "==SUPPRESS==",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "show this help message and exit"
    },
    {
      "optionStrings": [],
      "dest": "input_path",
      "action": "_StoreAction",
      "nargs": "?",
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": "FILE",
      "help": "The CSV file to operate on. If omitted, will accept input as piped data via STDIN."
    },
    {
      "optionStrings": [
        "-d",
        "--delimiter"
      ],
      "dest": "delimiter",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Delimiting character of the input CSV file."
    },
    {
      "optionStrings": [
        "-t",
        "--tabs"
      ],
      "dest": "tabs",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify that the input CSV file is delimited with tabs. Overrides \"-d\"."
    },
    {
      "optionStrings": [
        "-q",
        "--quotechar"
      ],
      "dest": "quotechar",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Character used to quote strings in the input CSV file."
    },
    {
      "optionStrings": [
        "-u",
        "--quoting"
      ],
      "dest": "quoting",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": [
        0,
        1,
        2,
        3,
        4,
        5
      ],
      "metavar": null,
      "help": "Quoting style used in the input CSV file: 0 quote minimal, 1 quote all, 2 quote non-numeric, 3 quote none."
    },
    {
      "optionStrings": [
        "-b",
        "--no-doublequote"
      ],
      "dest": "doublequote",
      "action": "_StoreFalseAction",
      "nargs": 0,
      "default": true,
      "const": false,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Whether or not double quotes are doubled in the input CSV file."
    },
    {
      "optionStrings": [
        "-p",
        "--escapechar"
      ],
      "dest": "escapechar",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Character used to escape the delimiter if --quoting 3 (\"quote none\") is specified and to escape the QUOTECHAR if --no-doublequote is specified."
    },
    {
      "optionStrings": [
        "-z",
        "--maxfieldsize"
      ],
      "dest": "field_size_limit",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "Maximum length of a single field in the input CSV file."
    },
    {
      "optionStrings": [
        "-e",
        "--encoding"
      ],
      "dest": "encoding",
      "action": "_StoreAction",
      "nargs": null,
      "default": "utf-8-sig",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify the encoding of the input CSV file."
    },
    {
      "optionStrings": [
        "-L",
        "--locale"
      ],
      "dest": "locale",
      "action": "_StoreAction",
      "nargs": null,
      "default": "en_US",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify the locale (en_US) of any formatted numbers."
    },
    {
      "optionStrings": [
        "-S",
        "--skipinitialspace"
      ],
      "dest": "skipinitialspace",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Ignore whitespace immediately following the delimiter."
    },
    {
      "optionStrings": [
        "--blanks"
      ],
      "dest": "blanks",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Do not convert \"\", \"na\", \"n/a\", \"none\", \"null\", \".\" to NULL."
    },
    {
      "optionStrings": [
        "--null-value"
      ],
      "dest": "null_values",
      "action": "_StoreAction",
      "nargs": "+",
      "default": [],
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Convert this value to NULL. --null-value can be specified multiple times."
    },
    {
      "optionStrings": [
        "--date-format"
      ],
      "dest": "date_format",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify a strptime date format string like \"%%m/%%d/%%Y\"."
    },
    {
      "optionStrings": [
        "--datetime-format"
      ],
      "dest": "datetime_format",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify a strptime datetime format string like \"%%m/%%d/%%Y %%I:%%M %%p\"."
    },
    {
      "optionStrings": [
        "--no-leading-zeroes"
      ],
      "dest": "no_leading_zeroes",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Do not convert a numeric value with leading zeroes to a number."
    },
    {
      "optionStrings": [
        "-H",
        "--no-header-row"
      ],
      "dest": "no_header_row",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify that the input CSV file has no header row. Will create default headers (a,b,c,...)."
    },
    {
      "optionStrings": [
        "-K",
        "--skip-lines"
      ],
      "dest": "skip_lines",
      "action": "_StoreAction",
      "nargs": null,
      "default": 0,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "Specify the number of initial lines to skip before the header row (e.g. comments, copyright notices, empty rows)."
    },
    {
      "optionStrings": [
        "-v",
        "--verbose"
      ],
      "dest": "verbose",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Print detailed tracebacks when errors occur."
    },
    {
      "optionStrings": [
        "-l",
        "--linenumbers"
      ],
      "dest": "line_numbers",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Insert a column of line numbers at the front of the output. Useful when piping to grep or as a simple primary key."
    },
    {
      "optionStrings": [
        "--add-bom"
      ],
      "dest": "add_bom",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Add the UTF-8 byte-order mark (BOM) to the output, for Excel compatibility"
    },
    {
      "optionStrings": [
        "--zero"
      ],
      "dest": "zero_based",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "When interpreting or displaying column numbers, use zero-based numbering instead of the default 1-based numbering."
    },
    {
      "optionStrings": [
        "-V",
        "--version"
      ],
      "dest": "version",
      "action": "_VersionAction",
      "nargs": 0,
      "default": "==SUPPRESS==",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Display version information and exit."
    },
    {
      "optionStrings": [
        "--csv"
      ],
      "dest": "csv_output",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Output results as a CSV table, rather than plain text."
    },
    {
      "optionStrings": [
        "--json"
      ],
      "dest": "json_output",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Output results as JSON text, rather than plain text."
    },
    {
      "optionStrings": [
        "-i",
        "--indent"
      ],
      "dest": "indent",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "Indent the output JSON this many spaces. Disabled by default."
    },
    {
      "optionStrings": [
        "-n",
        "--names"
      ],
      "dest": "names_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Display column names and indices from the input CSV and exit."
    },
    {
      "optionStrings": [
        "-c",
        "--columns"
      ],
      "dest": "columns",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A comma-separated list of column indices, names or ranges to be examined, e.g. \"1,id,3-5\". Defaults to all columns."
    },
    {
      "optionStrings": [
        "--type"
      ],
      "dest": "type_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output data type."
    },
    {
      "optionStrings": [
        "--nulls"
      ],
      "dest": "nulls_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output whether columns contains nulls."
    },
    {
      "optionStrings": [
        "--non-nulls"
      ],
      "dest": "nonnulls_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output counts of non-null values."
    },
    {
      "optionStrings": [
        "--unique"
      ],
      "dest": "unique_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output counts of unique values."
    },
    {
      "optionStrings": [
        "--min"
      ],
      "dest": "min_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output smallest values."
    },
    {
      "optionStrings": [
        "--max"
      ],
      "dest": "max_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output largest values."
    },
    {
      "optionStrings": [
        "--sum"
      ],
      "dest": "sum_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output sums."
    },
    {
      "optionStrings": [
        "--mean"
      ],
      "dest": "mean_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output means."
    },
    {
      "optionStrings": [
        "--median"
      ],
      "dest": "median_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output medians."
    },
    {
      "optionStrings": [
        "--stdev"
      ],
      "dest": "stdev_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output standard deviations."
    },
    {
      "optionStrings": [
        "--len"
      ],
      "dest": "len_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output the length of the longest values."
    },
    {
      "optionStrings": [
        "--max-precision"
      ],
      "dest": "maxprecision_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output the most decimal places."
    },
    {
      "optionStrings": [
        "--freq"
      ],
      "dest": "freq_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output lists of frequent values."
    },
    {
      "optionStrings": [
        "--freq-count"
      ],
      "dest": "freq_count",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "The maximum number of frequent values to display."
    },
    {
      "optionStrings": [
        "--count"
      ],
      "dest": "count_only",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Only output total row count."
    },
    {
      "optionStrings": [
        "--decimal-format"
      ],
      "dest": "decimal_format",
      "action": "_StoreAction",
      "nargs": null,
      "default": "%.3f",
      "const": null,
      "required": false,
      "type": "builtins.str",
      "choices": null,
      "metavar": null,
      "help": "%%-format specification for printing decimal numbers. Defaults to locale-specific formatting with \"%%.3f\"."
    },
    {
      "optionStrings": [
        "-G",
        "--no-grouping-separator"
      ],
      "dest": "no_grouping_separator",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Do not use grouping separators in decimal numbers."
    },
    {
      "optionStrings": [
        "-y",
        "--snifflimit"
      ],
      "dest": "sniff_limit",
      "action": "_StoreAction",
      "nargs": null,
      "default": 1024,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "Limit CSV dialect sniffing to the specified number of bytes. Specify \"0\" to disable sniffing entirely, or \"-1\" to sniff the entire file."
    },
    {
      "optionStrings": [
        "-I",
        "--no-inference"
      ],
      "dest": "no_inference",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Disable type inference (and --locale, --date-format, --datetime-format, --no-leading-zeroes) when parsing the input."
    }
  ]
} satisfies CommandDescriptor;
