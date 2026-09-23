// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { defaultHeaders } from "../columns.js";
import { CsvkitDiagnostic } from "../errors.js";
import { readTable } from "../table/index.js";
import { writeCsvRow, type CsvDialect } from "../csv.js";
import { inputWriteCell } from "../operations/input-cells.js";

async function format(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  await runtime.prompt();
  const dialect: CsvDialect = {
    delimiter: o.out_asv ? "\x1f" : o.out_tabs ? "\t" : String(o.out_delimiter || ","),
    lineterminator: o.out_asv ? "\x1e" : String(o.out_lineterminator || "\n"),
    quotechar: String(o.out_quotechar ?? '"'), quoting: Number(o.out_quoting ?? 0),
    doublequote: o.out_doublequote !== false,
    ...(o.out_escapechar === null || o.out_escapechar === undefined ? {} : { escapechar: String(o.out_escapechar) })
  };
  // Writer validation precedes reading, including empty inputs.
  writeCsvRow([], dialect);
  if (o.out_quoting === 2) {
    const table = await readTable(runtime, undefined, undefined, true, false, true);
    if (!o.skip_header) await runtime.row(table.headers, dialect);
    for (const row of table.rows) await runtime.row(row, dialect);
    return 0;
  }
  let first = true;
  for await (const record of runtime.records(undefined, undefined, undefined, undefined, undefined, true)) {
    if (first) {
      first = false;
      if (o.no_header_row && !o.skip_header) await runtime.row(defaultHeaders(record.cells.length), dialect);
      if (!o.no_header_row && o.skip_header) continue;
    }
    await runtime.row(record.cells.map(inputWriteCell), dialect);
  }
  if (first && (o.no_header_row || o.skip_header)) throw new CsvkitDiagnostic("StopIteration: ");
  return 0;
}


export const csvformat = {
  execute: format,
  "name": "csvformat",
  "usage": "usage: csvformat [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]\n                 [-b] [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING]\n                 [-L LOCALE] [-S] [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom]\n                 [--zero] [-V] [-E] [-D OUT_DELIMITER] [-T] [-A]\n                 [-Q OUT_QUOTECHAR] [-U {0,1,2,3,4,5}] [-B]\n                 [-P OUT_ESCAPECHAR] [-M OUT_LINETERMINATOR]\n                 [FILE]\n",
  "help": "usage: csvformat [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]\n                 [-b] [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING]\n                 [-L LOCALE] [-S] [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom]\n                 [--zero] [-V] [-E] [-D OUT_DELIMITER] [-T] [-A]\n                 [-Q OUT_QUOTECHAR] [-U {0,1,2,3,4,5}] [-B]\n                 [-P OUT_ESCAPECHAR] [-M OUT_LINETERMINATOR]\n                 [FILE]\n\nConvert a CSV file to a custom output format.\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -L, --locale LOCALE   Specify the locale (en_US) of any formatted numbers.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -E, --skip-header     Do not output a header row.\n  -D, --out-delimiter OUT_DELIMITER\n                        Delimiting character of the output file.\n  -T, --out-tabs        Specify that the output file is delimited with tabs.\n                        Overrides \"-D\".\n  -A, --out-asv         Specify that the output file is delimited with the\n                        ASCII unit separator and record separator. Overrides\n                        \"-T\", \"-D\" and \"-M\".\n  -Q, --out-quotechar OUT_QUOTECHAR\n                        Character used to quote strings in the output file.\n  -U, --out-quoting {0,1,2,3,4,5}\n                        Quoting style used in the output file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -B, --out-no-doublequote\n                        Whether or not double quotes are doubled in the output\n                        file.\n  -P, --out-escapechar OUT_ESCAPECHAR\n                        Character used to escape the delimiter in the output\n                        file if --quoting 3 (\"Quote None\") is specified and to\n                        escape the QUOTECHAR if --out-no-doublequote is\n                        specified.\n  -M, --out-lineterminator OUT_LINETERMINATOR\n                        Character used to terminate lines in the output file.\n",
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
        "-E",
        "--skip-header"
      ],
      "dest": "skip_header",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Do not output a header row."
    },
    {
      "optionStrings": [
        "-D",
        "--out-delimiter"
      ],
      "dest": "out_delimiter",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Delimiting character of the output file."
    },
    {
      "optionStrings": [
        "-T",
        "--out-tabs"
      ],
      "dest": "out_tabs",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify that the output file is delimited with tabs. Overrides \"-D\"."
    },
    {
      "optionStrings": [
        "-A",
        "--out-asv"
      ],
      "dest": "out_asv",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify that the output file is delimited with the ASCII unit separator and record separator. Overrides \"-T\", \"-D\" and \"-M\"."
    },
    {
      "optionStrings": [
        "-Q",
        "--out-quotechar"
      ],
      "dest": "out_quotechar",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Character used to quote strings in the output file."
    },
    {
      "optionStrings": [
        "-U",
        "--out-quoting"
      ],
      "dest": "out_quoting",
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
      "help": "Quoting style used in the output file: 0 quote minimal, 1 quote all, 2 quote non-numeric, 3 quote none."
    },
    {
      "optionStrings": [
        "-B",
        "--out-no-doublequote"
      ],
      "dest": "out_doublequote",
      "action": "_StoreFalseAction",
      "nargs": 0,
      "default": true,
      "const": false,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Whether or not double quotes are doubled in the output file."
    },
    {
      "optionStrings": [
        "-P",
        "--out-escapechar"
      ],
      "dest": "out_escapechar",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Character used to escape the delimiter in the output file if --quoting 3 (\"Quote None\") is specified and to escape the QUOTECHAR if --out-no-doublequote is specified."
    },
    {
      "optionStrings": [
        "-M",
        "--out-lineterminator"
      ],
      "dest": "out_lineterminator",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Character used to terminate lines in the output file."
    }
  ]
} satisfies CommandDescriptor;
