// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { printNames, parseColumnIdentifiers } from "../columns.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { readTable } from "../table/index.js";
import { temporalOrder } from "../types/temporal.js";
import { compareDecimals } from "../table/decimal-order.js";
import { upperText } from "../python-text.js";

/** Python text ordering compares Unicode codepoints, rather than UTF-16 units. */
function compareText(a: string, b: string, runtime: Runtime): number {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  while (true) {
    runtime.step();
    const x = left.next(); const y = right.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const difference = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (difference) return difference;
  }
}

async function sort(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  if (o.names_only) return printNames(runtime);
  if (runtime.context.terminal.stdinIsTTY && !o.input_path) runtime.error("You must provide an input file or piped data.");
  const table = await readTable(runtime, undefined, undefined, true);
  const headers = table.headers;
  runtime.retain(32 + table.rows.length * 8);
  const rows = [...table.rows];
  const columns = parseColumnIdentifiers(o.columns as string | null, headers, o.zero_based ? 0 : 1, null, runtime.step, true);
  // Materialize keys once, matching Python sorted(key=...) evaluation.
  runtime.retain(64 + rows.length * (32 + columns.length * 8));
  const keyed = rows.map(row => columns.map(index => {
    runtime.step();
    const value = row[index]!;
    const key = o.ignore_case && typeof value === "string" ? upperText(value, runtime.step) : value;
    if (key !== value && typeof key === "string") runtime.retain(32 + key.length * 2);
    return key;
  }));
  runtime.retain(32 + rows.length * 8);
  const indices = rows.map((_, index) => index);
  indices.sort((a, b) => {
    runtime.step();
    for (let index = 0; index < columns.length; index++) {
      const x = keyed[a]![index]!; const y = keyed[b]![index]!;
      let order: number;
      if (x === null || y === null) order = x === null ? (y === null ? 0 : 1) : -1;
      else if (typeof x === "string" && typeof y === "string") order = compareText(x, y, runtime);
      else if (typeof x === "boolean" && typeof y === "boolean") order = Number(x) - Number(y);
      else if (typeof x === "object" && typeof y === "object" && x.kind === "decimal" && y.kind === "decimal") {
        if (x.value.includes("NaN") || y.value.includes("NaN")) throw new CsvkitDiagnostic("InvalidOperation: [<class 'decimal.InvalidOperation'>]");
        order = compareDecimals(x.value, y.value, runtime.step);
      }
      else if (typeof x === "object" && typeof y === "object" && x.kind === "timedelta" && y.kind === "timedelta") order = x.microseconds < y.microseconds ? -1 : x.microseconds > y.microseconds ? 1 : 0;
      else if (typeof x === "object" && typeof y === "object" && (x.kind === "date" || x.kind === "datetime") && x.kind === y.kind) {
        if (x.kind === "datetime" && /[+-]\d{2}:\d{2}(?::\d{2}(?:\.\d{6})?)?$/.test(x.value) !== /[+-]\d{2}:\d{2}(?::\d{2}(?:\.\d{6})?)?$/.test(y.value)) throw new CsvkitDiagnostic("TypeError: can't compare offset-naive and offset-aware datetimes");
        const left = temporalOrder(x.value); const right = temporalOrder(y.value);
        order = left < right ? -1 : left > right ? 1 : 0;
      }
      else throw new CsvkitBlocked("typed column ordering");
      if (order) return o.reverse ? -order : order;
    }
    return 0;
  });
  await runtime.row(headers);
  for (const index of indices) await runtime.row(rows[index]!.map(value => {
    runtime.step();
    return typeof value === "object" && value?.kind === "datetime" ? { ...value, value: value.value.replace(" ", "T") } : value;
  }));
  return 0;
}

export const csvsort = {
  execute: sort,
  "name": "csvsort",
  "usage": "usage: csvsort [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [-n] [-c COLUMNS] [-r] [-i]\n               [-y SNIFF_LIMIT] [-I]\n               [FILE]\n",
  "help": "usage: csvsort [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [-n] [-c COLUMNS] [-r] [-i]\n               [-y SNIFF_LIMIT] [-I]\n               [FILE]\n\nSort CSV files. Like the Unix \"sort\" command, but for tabular data.\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -L, --locale LOCALE   Specify the locale (en_US) of any formatted numbers.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  --blanks              Do not convert \"\", \"na\", \"n/a\", \"none\", \"null\", \".\" to\n                        NULL.\n  --null-value NULL_VALUES [NULL_VALUES ...]\n                        Convert this value to NULL. --null-value can be\n                        specified multiple times.\n  --date-format DATE_FORMAT\n                        Specify a strptime date format string like \"%m/%d/%Y\".\n  --datetime-format DATETIME_FORMAT\n                        Specify a strptime datetime format string like\n                        \"%m/%d/%Y %I:%M %p\".\n  --no-leading-zeroes   Do not convert a numeric value with leading zeroes to\n                        a number.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -n, --names           Display column names and indices from the input CSV\n                        and exit.\n  -c, --columns COLUMNS\n                        A comma-separated list of column indices, names or\n                        ranges to sort by, e.g. \"1,id,3-5\". Defaults to all\n                        columns.\n  -r, --reverse         Sort in descending order.\n  -i, --ignore-case     Perform case-independent sorting.\n  -y, --snifflimit SNIFF_LIMIT\n                        Limit CSV dialect sniffing to the specified number of\n                        bytes. Specify \"0\" to disable sniffing entirely, or\n                        \"-1\" to sniff the entire file.\n  -I, --no-inference    Disable type inference (and --locale, --date-format,\n                        --datetime-format, --no-leading-zeroes) when parsing\n                        the input.\n",
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
      "help": "A comma-separated list of column indices, names or ranges to sort by, e.g. \"1,id,3-5\". Defaults to all columns."
    },
    {
      "optionStrings": [
        "-r",
        "--reverse"
      ],
      "dest": "reverse",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Sort in descending order."
    },
    {
      "optionStrings": [
        "-i",
        "--ignore-case"
      ],
      "dest": "ignore_case",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Perform case-independent sorting."
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
