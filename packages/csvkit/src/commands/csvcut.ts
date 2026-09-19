// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { defaultHeaders, printNames, parseColumnIdentifiers } from "../columns.js";

async function cut(runtime: Runtime): Promise<number> {
  if (runtime.options.names_only) return printNames(runtime);
  await runtime.prompt();
  let headers: readonly string[] | undefined;
  let columns: number[] = [];
  for await (const record of runtime.records()) {
    if (headers === undefined) {
      const generated = Boolean(runtime.options.no_header_row);
      headers = generated ? defaultHeaders(record.cells.length) : record.cells;
      columns = parseColumnIdentifiers(runtime.options.columns as string | null, headers,
        runtime.options.zero_based ? 0 : 1, runtime.options.not_columns as string | null,
        runtime.step, generated);
      await runtime.row(columns.map(index => headers![index]!));
      if (!generated) continue;
    }
    const selected = columns.map(index => record.cells[index] ?? null);
    if (!runtime.options.delete_empty || selected.some(value => value)) await runtime.row(selected);
  }
  // The source helper returns empty headers before validating selectors at EOF.
  if (headers === undefined) await runtime.row([]);
  return 0;
}

export const csvcut = {
  execute: cut,
  "name": "csvcut",
  "usage": "usage: csvcut [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S] [-H]\n              [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V] [-n]\n              [-c COLUMNS] [-C NOT_COLUMNS] [-x]\n              [FILE]\n",
  "help": "usage: csvcut [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S] [-H]\n              [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V] [-n]\n              [-c COLUMNS] [-C NOT_COLUMNS] [-x]\n              [FILE]\n\nFilter and truncate CSV files. Like the Unix \"cut\" command, but for tabular\ndata.\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -n, --names           Display column names and indices from the input CSV\n                        and exit.\n  -c, --columns COLUMNS\n                        A comma-separated list of column indices, names or\n                        ranges to be extracted, e.g. \"1,id,3-5\". Defaults to\n                        all columns.\n  -C, --not-columns NOT_COLUMNS\n                        A comma-separated list of column indices, names or\n                        ranges to be excluded, e.g. \"1,id,3-5\". Defaults to no\n                        columns.\n  -x, --delete-empty-rows\n                        After cutting, delete rows which are completely empty.\n",
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
      "help": "A comma-separated list of column indices, names or ranges to be extracted, e.g. \"1,id,3-5\". Defaults to all columns."
    },
    {
      "optionStrings": [
        "-C",
        "--not-columns"
      ],
      "dest": "not_columns",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A comma-separated list of column indices, names or ranges to be excluded, e.g. \"1,id,3-5\". Defaults to no columns."
    },
    {
      "optionStrings": [
        "-x",
        "--delete-empty-rows"
      ],
      "dest": "delete_empty",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "After cutting, delete rows which are completely empty."
    }
  ]
} satisfies CommandDescriptor;
