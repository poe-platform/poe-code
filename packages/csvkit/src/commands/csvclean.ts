// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { writeCsvRow } from "../csv.js";
import { CsvkitDiagnostic } from "../errors.js";
import { integerWhitespace } from "../unicode-profile.js";
import { repr } from "../cli/parser.js";

export const csvclean = {
  execute: clean,
  "name": "csvclean",
  "usage": "usage: csvclean [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]\n                [-b] [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S]\n                [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V]\n                [--length-mismatch] [--empty-columns] [-a] [--omit-error-rows]\n                [--label LABEL] [--header-normalize-space] [--join-short-rows]\n                [--separator SEPARATOR] [--fill-short-rows]\n                [--fillvalue FILLVALUE]\n                [FILE]\n",
  "help": "usage: csvclean [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]\n                [-b] [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S]\n                [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V]\n                [--length-mismatch] [--empty-columns] [-a] [--omit-error-rows]\n                [--label LABEL] [--header-normalize-space] [--join-short-rows]\n                [--separator SEPARATOR] [--fill-short-rows]\n                [--fillvalue FILLVALUE]\n                [FILE]\n\nReport and fix common errors in a CSV file.\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  --length-mismatch     Report data rows that are shorter or longer than the\n                        header row.\n  --empty-columns       Report empty columns as errors.\n  -a, --enable-all-checks\n                        Enable all error reporting.\n  --omit-error-rows     Omit data rows that contain errors, from standard\n                        output.\n  --label LABEL         Add a \"label\" column to standard error. Useful in\n                        automated workflows. Use \"-\" to default to the input\n                        filename.\n  --header-normalize-space\n                        Strip leading and trailing whitespace and replace\n                        sequences of whitespace characters by a single space\n                        in the header.\n  --join-short-rows     Merges short rows into a single row.\n  --separator SEPARATOR\n                        The string with which to join short rows. Defaults to\n                        a newline.\n  --fill-short-rows     Fill short rows with the missing cells.\n  --fillvalue FILLVALUE\n                        The value with which to fill short rows. Defaults to\n                        none.\n",
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
        "--length-mismatch"
      ],
      "dest": "length_mismatch",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Report data rows that are shorter or longer than the header row."
    },
    {
      "optionStrings": [
        "--empty-columns"
      ],
      "dest": "empty_columns",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Report empty columns as errors."
    },
    {
      "optionStrings": [
        "-a",
        "--enable-all-checks"
      ],
      "dest": "enable_all_checks",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Enable all error reporting."
    },
    {
      "optionStrings": [
        "--omit-error-rows"
      ],
      "dest": "omit_error_rows",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Omit data rows that contain errors, from standard output."
    },
    {
      "optionStrings": [
        "--label"
      ],
      "dest": "label",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Add a \"label\" column to standard error. Useful in automated workflows. Use \"-\" to default to the input filename."
    },
    {
      "optionStrings": [
        "--header-normalize-space"
      ],
      "dest": "header_normalize_space",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Strip leading and trailing whitespace and replace sequences of whitespace characters by a single space in the header."
    },
    {
      "optionStrings": [
        "--join-short-rows"
      ],
      "dest": "join_short_rows",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Merges short rows into a single row."
    },
    {
      "optionStrings": [
        "--separator"
      ],
      "dest": "separator",
      "action": "_StoreAction",
      "nargs": null,
      "default": "\n",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "The string with which to join short rows. Defaults to a newline."
    },
    {
      "optionStrings": [
        "--fill-short-rows"
      ],
      "dest": "fill_short_rows",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Fill short rows with the missing cells."
    },
    {
      "optionStrings": [
        "--fillvalue"
      ],
      "dest": "fillvalue",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "The value with which to fill short rows. Defaults to none."
    }
  ]
} satisfies CommandDescriptor;

function normalizedHeader(value: string): string {
  const words: string[] = [];
  let word = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (integerWhitespace.includes(code) || code >= 0x1c && code <= 0x1f) {
      if (word) words.push(word);
      word = "";
    } else word += char;
  }
  if (word) words.push(word);
  return words.join(" ");
}

interface RowError { line: number; row: (string | null)[]; message: string }

async function clean(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  await runtime.prompt();
  if (!o.length_mismatch && !o.empty_columns && !o.enable_all_checks && !o.header_normalize_space && !o.join_short_rows && !o.fill_short_rows)
    runtime.error("No checks or fixes were enabled. See available options with: csvclean --help");
  if (o.join_short_rows && o.fill_short_rows) runtime.error("The --join-short-rows and --fill-short-rows options are mutually exclusive.");
  const checkLength = Boolean(o.length_mismatch || o.enable_all_checks);
  const checkEmpty = Boolean(o.empty_columns || o.enable_all_checks);
  const errors: RowError[] = [];
  let joinable: RowError[] = [];
  let headers: string[] | undefined;
  let empties: number[] = [];
  let count = 0;
  for await (const record of runtime.records()) {
    if (headers === undefined) {
      headers = record.cells.map(cell => o.header_normalize_space ? normalizedHeader(cell) : cell);
      empties = headers.map(() => 0);
      await runtime.row(headers);
      continue;
    }
    count++;
    let row: (string | null)[] = [...record.cells];
    const error: RowError = { line: record.line - 1, row, message: `Expected ${headers.length} columns, found ${row.length} columns` };
    let retained = false;
    if (o.fill_short_rows) while (row.length < headers.length) { runtime.step(); row.push(o.fillvalue as string | null); }
    else if (o.join_short_rows) {
      if (row.length >= headers.length) joinable = [];
      else {
        runtime.retain(64 + row.reduce((size, cell) => size + (cell?.length ?? 0) * 2 + 16, 0));
        retained = true;
        joinable.push(error);
        if (joinable.length > 1) {
          while (joinable.length) {
            const merged = [...joinable[0]!.row];
            for (const next of joinable.slice(1)) {
              runtime.step();
              if (merged.length === 0) throw new CsvkitDiagnostic("IndexError: list index out of range");
              merged[merged.length - 1] = String(merged.at(-1) ?? "") + String(o.separator) + (next.row[0] ?? "");
              merged.push(...next.row.slice(1));
            }
            if (merged.length < headers.length) break;
            if (merged.length === headers.length) {
              row = merged;
              if (checkLength) for (const fixed of joinable) {
                const index = errors.indexOf(fixed);
                if (index < 0) throw new CsvkitDiagnostic("ValueError: list.remove(x): x not in list");
                errors.splice(index, 1);
              }
              joinable = [];
              break;
            }
            joinable = joinable.slice(1);
          }
        }
      }
    }
    if (checkLength && row.length !== headers.length) {
      if (!retained) runtime.retain(64 + error.row.reduce((size, cell) => size + (cell?.length ?? 0) * 2 + 16, 0));
      errors.push(error);
    }
    if (checkEmpty) for (let index = 0; index < headers.length; index++) { runtime.step(); if (index >= row.length || row[index] === "") empties[index]!++; }
    if (!o.omit_error_rows || row.length === headers.length) await runtime.row(row);
  }
  if (headers === undefined) { headers = []; await runtime.row([]); }
  const emptyColumns = count ? empties.flatMap((value, index) => value === count ? [index] : []) : [];
  if (emptyColumns.length) errors.push({ line: 1, row: headers.map(() => ""), message: `Empty columns named ${emptyColumns.map(index => repr(headers![index]!)).join(", ")}! Try: csvcut -C ${emptyColumns.map(index => index + (o.zero_based ? 0 : 1)).join(",")}` });
  if (!errors.length) return 0;
  const label = o.label === "-" ? (!o.input_path || o.input_path === "-" ? "stdin" : String(o.input_path)) : String(o.label);
  const errorHeaders = [...(o.label ? ["label"] : []), "line_number", "msg", ...headers];
  const numbered = Boolean(o.line_numbers);
  await runtime.write(writeCsvRow(numbered ? ["line_number", ...errorHeaders] : errorHeaders), "stderr");
  for (const [index, error] of errors.entries()) {
    const cells = [...(o.label ? [label] : []), error.line, error.message, ...error.row];
    await runtime.write(writeCsvRow(numbered ? [index + 1, ...cells] : cells), "stderr");
  }
  return 1;
}
