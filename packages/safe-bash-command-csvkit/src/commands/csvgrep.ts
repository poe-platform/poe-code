// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { defaultHeaders, printNames, parseColumnIdentifiers } from "../columns.js";
import type { MatchFile } from "../match-files.js";
import { compilePythonSearch, pythonWhitespace } from "../python-regex.js";

async function grep(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  if (o.names_only) return printNames(runtime);
  await runtime.prompt();
  if (!o.columns) runtime.error("You must specify at least one column to search using the -c option.");
  if (o.regex === null && o.pattern === null && o.matchfile === null) runtime.error("One of -r, -m or -f must be specified, unless using the -n option.");
  const rows = runtime.records();
  try {
    const first = await rows.next();
    const numbered = Boolean(o.line_numbers);
    const numberedRow = (record: { cells: readonly string[]; line: number }, header = false): string[] => {
      const row = [...record.cells];
      if (numbered) row.unshift(header ? "line_numbers" : String(record.line - (o.no_header_row ? 0 : 1)));
      return row;
    };
    const generated = Boolean(o.no_header_row);
    const firstRow = first.done ? [] : numberedRow(first.value, !generated);
    const headers = generated ? defaultHeaders(firstRow.length) : firstRow;
    const columns = first.done ? [] : parseColumnIdentifiers(o.columns as string, headers,
      (o.zero_based ? 0 : 1) - (numbered ? 1 : 0), null, runtime.step, generated);
    let predicate: ((value: string) => boolean) | undefined;
    if (o.regex) predicate = compilePythonSearch(String(o.regex), runtime.step, runtime.context.limits.maxRegexWork, runtime.retain.bind(runtime));
    else if (o.matchfile) {
      const file = o.matchfile as MatchFile;
      const lines = new Set<string>();
      for await (const line of file.lines()) {
        runtime.step();
        let end = line.length;
        while (end > 0 && pythonWhitespace(line[end - 1]!)) { runtime.step(); end--; }
        const value = line.slice(0, end);
        runtime.retain(64 + value.length * 2);
        lines.add(value);
      }
      await runtime.matchFiles!.close(file);
      predicate = value => lines.has(value);
    } else if (o.pattern) predicate = value => value.includes(String(o.pattern));
    // Dict standardization removes falsey strings and collapses repeated selectors.
    const selected = predicate ? [...new Set(columns)] : [];
    const writeMatch = async (row: string[]): Promise<void> => {
      let matches = !o.any_match;
      for (const column of selected) {
        runtime.step();
        const result = predicate!(row[column] ?? "");
        if (o.any_match ? result : !result) { matches = result; break; }
      }
      if (matches !== Boolean(o.inverse)) await runtime.row(row, {}, false);
    };
    await runtime.row(headers, {}, false);
    if (!first.done && generated) await writeMatch(firstRow);
    for await (const record of rows) await writeMatch(numberedRow(record));
    return 0;
  } finally { await rows.return(undefined); }
}

export const csvgrep = {
  execute: grep,
  "name": "csvgrep",
  "usage": "usage: csvgrep [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S] [-H]\n               [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V] [-n]\n               [-c COLUMNS] [-m PATTERN] [-r REGEX] [-f MATCHFILE] [-i] [-a]\n               [FILE]\n",
  "help": "usage: csvgrep [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S] [-H]\n               [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V] [-n]\n               [-c COLUMNS] [-m PATTERN] [-r REGEX] [-f MATCHFILE] [-i] [-a]\n               [FILE]\n\nSearch CSV files. Like the Unix \"grep\" command, but for tabular data.\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -n, --names           Display column names and indices from the input CSV\n                        and exit.\n  -c, --columns COLUMNS\n                        A comma-separated list of column indices, names or\n                        ranges to be searched, e.g. \"1,id,3-5\".\n  -m, --match PATTERN   A string to search for.\n  -r, --regex REGEX     A regular expression to match.\n  -f, --file MATCHFILE  A path to a file. For each row, if any line in the\n                        file (stripped of line separators) is an exact match\n                        of the cell value, the row matches.\n  -i, --invert-match    Select non-matching rows, instead of matching rows.\n  -a, --any-match       Select rows in which any column matches, instead of\n                        all columns.\n",
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
      "help": "A comma-separated list of column indices, names or ranges to be searched, e.g. \"1,id,3-5\"."
    },
    {
      "optionStrings": [
        "-m",
        "--match"
      ],
      "dest": "pattern",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A string to search for."
    },
    {
      "optionStrings": [
        "-r",
        "--regex"
      ],
      "dest": "regex",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A regular expression to match."
    },
    {
      "optionStrings": [
        "-f",
        "--file"
      ],
      "dest": "matchfile",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": "FileType('r')",
      "choices": null,
      "metavar": null,
      "help": "A path to a file. For each row, if any line in the file (stripped of line separators) is an exact match of the cell value, the row matches."
    },
    {
      "optionStrings": [
        "-i",
        "--invert-match"
      ],
      "dest": "inverse",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Select non-matching rows, instead of matching rows."
    },
    {
      "optionStrings": [
        "-a",
        "--any-match"
      ],
      "dest": "any_match",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Select rows in which any column matches, instead of all columns."
    }
  ]
} satisfies CommandDescriptor;
