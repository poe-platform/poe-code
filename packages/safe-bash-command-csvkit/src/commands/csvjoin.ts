// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { readTable, type TableValue } from "../table/index.js";
import { normalizeHeaders } from "../table/headers.js";
import { match } from "../columns.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { Decimal } from "../types/decimal.js";
import { temporalOrder } from "../types/temporal.js";
import { stripWhitespace } from "../python-text.js";

interface JoinTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly TableValue[])[];
}

/** Python numeric equality includes bool/Decimal and ignores Decimal scale. */
function keyValue(value: TableValue, runtime: Runtime): string | symbol {
  runtime.step();
  if (value === null) return "null";
  if (typeof value === "string") return "text:" + value;
  if (typeof value === "boolean") return value ? "number:1:0" : "number:0";
  if (value.kind === "decimal") {
    const number = Decimal.parse(value.value);
    if (number.special === "NaN") return Symbol("NaN");
    if (number.special) return "number:" + value.value;
    if (number.coefficient === 0n) return "number:0";
    const digits = number.coefficient.toString();
    let end = digits.length;
    while (digits[end - 1] === "0") { runtime.step(); end--; }
    return "number:" + (number.negative ? "-" : "") + digits.slice(0, end) + ":" + (number.exponent + digits.length - end);
  }
  if (value.kind === "timedelta") return "duration:" + value.microseconds;
  if (value.kind === "date") return "date:" + value.value;
  // Aware datetimes compare by instant; naive and aware values remain distinct.
  const aware = value.value.slice(10).includes("+") || value.value.slice(10).includes("-");
  return "datetime:" + aware + ":" + temporalOrder(value.value);
}

async function combine(runtime: Runtime, left: JoinTable, right: JoinTable, leftKey: number | undefined, rightKey: number | undefined, full: boolean, inner: boolean): Promise<JoinTable> {
  // Agate finds the selected Column with sequence.index(), which compares
  // column values rather than names/identity. Empty columns all compare equal.
  let omittedKey = rightKey;
  if (!full && rightKey !== undefined) {
    for (let index = 0; index < rightKey; index++) {
      runtime.step();
      if (right.rows.every(row => {
        runtime.step();
        return row[index] === row[rightKey] || keyValue(row[index]!, runtime) === keyValue(row[rightKey]!, runtime);
      })) { omittedKey = index; break; }
    }
  }
  const included = right.headers.map((_, index) => index).filter(index => full || index !== omittedKey);
  if (left.headers.length + included.length > runtime.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
  const headers = await normalizeHeaders([...left.headers, ...included.map(index => left.headers.includes(right.headers[index]!) ? right.headers[index]! + "2" : right.headers[index]!)], runtime);
  const hash = new Map<string | symbol, (readonly TableValue[])[]>();
  const rightKeys: (string | symbol)[] = [];
  for (const [index, row] of right.rows.entries()) {
    runtime.step(); runtime.retain(96);
    const key = rightKey === undefined ? "row:" + index : keyValue(row[rightKey]!, runtime);
    runtime.retain(typeof key === "string" ? key.length * 2 : 16);
    rightKeys.push(key);
    const matches = hash.get(key);
    if (matches) matches.push(row); else hash.set(key, [row]);
  }
  const rows: TableValue[][] = [];
  const seen = new Set<string | symbol>();
  const append = (a: readonly TableValue[], b?: readonly TableValue[]): void => {
    runtime.step();
    if (rows.length >= runtime.context.limits.maxRows) throw new CsvkitBlocked("join result row budget exceeded");
    runtime.retain(64 + headers.length * 16);
    rows.push([...a, ...included.map(index => { runtime.step(); return b?.[index] ?? null; })]);
  };
  for (const [index, row] of left.rows.entries()) {
    runtime.step(); runtime.retain(32);
    const key = leftKey === undefined ? "row:" + index : keyValue(row[leftKey]!, runtime);
    runtime.retain(typeof key === "string" ? key.length * 2 : 16);
    seen.add(key);
    const matches = hash.get(key);
    if (matches) for (const match of matches) append(row, match);
    else if (!inner) append(row);
  }
  if (full) for (const [index, row] of right.rows.entries()) {
    runtime.step();
    if (!seen.has(rightKeys[index]!)) append(left.headers.map(() => null), row);
  }
  return { headers, rows };
}

async function join(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  const paths = o.input_paths as readonly string[];
  if (runtime.context.terminal.stdinIsTTY && paths.length === 1 && paths[0] === "-") runtime.error("You must provide an input file or piped data.");
  let names = o.columns ? String(o.columns).split(",").map(stripWhitespace) : [];
  if (names.length === 1) names = paths.map(() => names[0]!);
  if (names.length && names.length !== paths.length) runtime.error("The number of join column names must match the number of files, or be a single column name that exists in all files.");
  if ((o.left_join || o.right_join || o.outer_join) && !o.columns) runtime.error("You must provide join column names when performing an outer join.");
  if (o.left_join && o.right_join) runtime.error("It is not valid to specify both a left and a right join.");
  // csvkit deliberately materializes every independently inferred input before joining.
  const tables: JoinTable[] = [];
  for (const path of paths) {
    tables.push(await readTable(runtime, path, undefined, true));
    // The original closes each parsed input, including its stdin wrapper.
    if (path === "-") await runtime.input(path, true).close();
  }
  if (!tables.length) throw new CsvkitDiagnostic("IndexError: list index out of range");
  // The original helper uses its default offset, even with inherited --zero.
  const keys = names.map((name, index) => match(tables[index]!.headers, name, 1, true));
  if (o.right_join) { tables.reverse(); keys.reverse(); }
  let table = tables[0]!;
  for (let index = 1; index < tables.length; index++) table = await combine(runtime, table, tables[index]!, keys[0], keys[index], !names.length || Boolean(o.outer_join && !o.left_join && !o.right_join), Boolean(names.length && !o.outer_join && !o.left_join && !o.right_join));
  await runtime.row(table.headers);
  for (const row of table.rows) await runtime.row(row.map(value => {
    runtime.step();
    return typeof value === "object" && value?.kind === "datetime" ? { ...value, value: value.value.replace(" ", "T") } : value;
  }));
  return 0;
}

export const csvjoin = {
  execute: join,
  "name": "csvjoin",
  "usage": "usage: csvjoin [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [-c COLUMNS] [--outer] [--left]\n               [--right] [-y SNIFF_LIMIT] [-I]\n               [FILE ...]\n",
  "help": "usage: csvjoin [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [-c COLUMNS] [--outer] [--left]\n               [--right] [-y SNIFF_LIMIT] [-I]\n               [FILE ...]\n\nExecute a SQL-like join to merge CSV files on a specified column or columns.\n\npositional arguments:\n  FILE                  The CSV files to operate on. If only one is specified,\n                        it will be copied to STDOUT.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -L, --locale LOCALE   Specify the locale (en_US) of any formatted numbers.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  --blanks              Do not convert \"\", \"na\", \"n/a\", \"none\", \"null\", \".\" to\n                        NULL.\n  --null-value NULL_VALUES [NULL_VALUES ...]\n                        Convert this value to NULL. --null-value can be\n                        specified multiple times.\n  --date-format DATE_FORMAT\n                        Specify a strptime date format string like \"%m/%d/%Y\".\n  --datetime-format DATETIME_FORMAT\n                        Specify a strptime datetime format string like\n                        \"%m/%d/%Y %I:%M %p\".\n  --no-leading-zeroes   Do not convert a numeric value with leading zeroes to\n                        a number.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -c, --columns COLUMNS\n                        The column name(s) on which to join. Should be either\n                        one name (or index) or a comma-separated list with one\n                        name (or index) per file, in the same order in which\n                        the files were specified. If not specified, the two\n                        files will be joined sequentially without matching.\n  --outer               Perform a full outer join, rather than the default\n                        inner join.\n  --left                Perform a left outer join, rather than the default\n                        inner join. If more than two files are provided this\n                        will be executed as a sequence of left outer joins,\n                        starting at the left.\n  --right               Perform a right outer join, rather than the default\n                        inner join. If more than two files are provided this\n                        will be executed as a sequence of right outer joins,\n                        starting at the right.\n  -y, --snifflimit SNIFF_LIMIT\n                        Limit CSV dialect sniffing to the specified number of\n                        bytes. Specify \"0\" to disable sniffing entirely, or\n                        \"-1\" to sniff the entire file.\n  -I, --no-inference    Disable type inference (and --locale, --date-format,\n                        --datetime-format, --no-leading-zeroes) when parsing\n                        the input.\n\nNote that the join operation requires reading all files into memory. Don't try\nthis on very large files.\n",
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
      "optionStrings": [],
      "dest": "input_paths",
      "action": "_StoreAction",
      "nargs": "*",
      "default": [
        "-"
      ],
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": "FILE",
      "help": "The CSV files to operate on. If only one is specified, it will be copied to STDOUT."
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
      "help": "The column name(s) on which to join. Should be either one name (or index) or a comma-separated list with one name (or index) per file, in the same order in which the files were specified. If not specified, the two files will be joined sequentially without matching."
    },
    {
      "optionStrings": [
        "--outer"
      ],
      "dest": "outer_join",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Perform a full outer join, rather than the default inner join."
    },
    {
      "optionStrings": [
        "--left"
      ],
      "dest": "left_join",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Perform a left outer join, rather than the default inner join. If more than two files are provided this will be executed as a sequence of left outer joins, starting at the left."
    },
    {
      "optionStrings": [
        "--right"
      ],
      "dest": "right_join",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Perform a right outer join, rather than the default inner join. If more than two files are provided this will be executed as a sequence of right outer joins, starting at the right."
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
