// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import { formats } from "../formats.js";
import type { Runtime } from "../runtime.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { WorkbookInput } from "../operations/workbook-input.js";
import { csvifiedRow } from "../operations/input-table.js";

/** Literal In2CSV.main dispatch; names and sheet side effects are command semantics. */
async function convert(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  const path = o.input_path as string | null;
  let provider = o.filetype ? formats.find(format => format.name === o.filetype) : formats.find(format => format.inferredBy && o[format.inferredBy]);
  if (!provider) {
    if (!path || path === "-") runtime.error("You must specify a format when providing input as piped data via STDIN.");
    const period = path.lastIndexOf(".");
    const extension = period < 0 ? undefined : path.slice(period + 1).toLowerCase();
    provider = formats.find(format => extension === undefined ? format.extensionless : format.extensions?.includes(extension));
    if (!provider) runtime.error("Unable to automatically determine the format of the input file. Try specifying a format with --format.");
  }
  const workbook = provider.sheetNames ? new WorkbookInput(runtime, provider.name as "xls" | "xlsx") : undefined;
  if (o.names_only) {
    if (!workbook) runtime.error("You cannot use the -n or --names options with non-Excel files.");
    for (const name of (await workbook.open(true)).SheetNames) await runtime.write(name + "\n");
    return 0;
  }
  // Upstream's schema LazyFile is constructed even when a forced format
  // wins, but an unused named schema is never opened or read.
  if (o.schema && provider.name !== "fixed") {
    runtime.input(String(o.schema));
  }
  if (workbook) {
    const [, table] = await workbook.table(await workbook.open(), o.sheet as string | null);
    await runtime.row(table.headers);
    for (const row of table.rows) await runtime.row(csvifiedRow(row));
  } else {
    if (!provider.convert) throw new CsvkitBlocked(`in2csv ${provider.name} format`);
    await provider.convert(runtime);
  }
  if (o.write_sheets) {
    runtime.sideEffects = true;
    if (workbook) await workbook.writeSheets();
    else {
      if (!path || path === "-") throw new CsvkitDiagnostic("ValueError: read of closed file");
      // Upstream reopens even non-workbooks after stdout before referencing
      // its unassigned tables local. Keep late read/open failures observable.
      for await (const ignored of runtime.bytes()) { runtime.step(); }
      if (o.write_sheets === "-") throw new CsvkitBlocked("non-Excel --write-sheets - workbook decoding");
      throw new CsvkitDiagnostic("UnboundLocalError: cannot access local variable 'tables' where it is not associated with a value");
    }
  }
  return 0;
}

export const in2csv = {
  execute: convert,
  "name": "in2csv",
  "usage": "usage: in2csv [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n              [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n              [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n              [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom]\n              [--zero] [-V] [-f {csv,dbf,fixed,geojson,json,ndjson,xls,xlsx}]\n              [-s SCHEMA] [-k KEY] [-n] [--sheet SHEET]\n              [--write-sheets WRITE_SHEETS] [--use-sheet-names]\n              [--reset-dimensions] [--encoding-xls ENCODING_XLS]\n              [-y SNIFF_LIMIT] [-I]\n              [FILE]\n",
  "help": "usage: in2csv [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n              [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n              [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n              [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom]\n              [--zero] [-V] [-f {csv,dbf,fixed,geojson,json,ndjson,xls,xlsx}]\n              [-s SCHEMA] [-k KEY] [-n] [--sheet SHEET]\n              [--write-sheets WRITE_SHEETS] [--use-sheet-names]\n              [--reset-dimensions] [--encoding-xls ENCODING_XLS]\n              [-y SNIFF_LIMIT] [-I]\n              [FILE]\n\nConvert common, but less awesome, tabular data formats to CSV.\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -L, --locale LOCALE   Specify the locale (en_US) of any formatted numbers.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  --blanks              Do not convert \"\", \"na\", \"n/a\", \"none\", \"null\", \".\" to\n                        NULL.\n  --null-value NULL_VALUES [NULL_VALUES ...]\n                        Convert this value to NULL. --null-value can be\n                        specified multiple times.\n  --date-format DATE_FORMAT\n                        Specify a strptime date format string like \"%m/%d/%Y\".\n  --datetime-format DATETIME_FORMAT\n                        Specify a strptime datetime format string like\n                        \"%m/%d/%Y %I:%M %p\".\n  --no-leading-zeroes   Do not convert a numeric value with leading zeroes to\n                        a number.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -f, --format {csv,dbf,fixed,geojson,json,ndjson,xls,xlsx}\n                        The format of the input file. If not specified will be\n                        inferred from the file type.\n  -s, --schema SCHEMA   Specify a CSV-formatted schema file for converting\n                        fixed-width files. See web documentation.\n  -k, --key KEY         Specify a top-level key to look within for a list of\n                        objects to be converted when processing JSON.\n  -n, --names           Display sheet names from the input Excel file.\n  --sheet SHEET         The name of the Excel sheet to operate on.\n  --write-sheets WRITE_SHEETS\n                        The names of the Excel sheets to write to files, or\n                        \"-\" to write all sheets.\n  --use-sheet-names     Use the sheet names as file names when --write-sheets\n                        is set.\n  --reset-dimensions    Ignore the sheet dimensions provided by the XLSX file.\n  --encoding-xls ENCODING_XLS\n                        Specify the encoding of the input XLS file.\n  -y, --snifflimit SNIFF_LIMIT\n                        Limit CSV dialect sniffing to the specified number of\n                        bytes. Specify \"0\" to disable sniffing entirely, or\n                        \"-1\" to sniff the entire file.\n  -I, --no-inference    Disable type inference (and --locale, --date-format,\n                        --datetime-format, --no-leading-zeroes) when parsing\n                        CSV input.\n\nSome command-line flags only pertain to specific input formats.\n",
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
        "-f",
        "--format"
      ],
      "dest": "filetype",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": formats.map(format => format.name),
      "metavar": null,
      "help": "The format of the input file. If not specified will be inferred from the file type."
    },
    {
      "optionStrings": [
        "-s",
        "--schema"
      ],
      "dest": "schema",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify a CSV-formatted schema file for converting fixed-width files. See web documentation."
    },
    {
      "optionStrings": [
        "-k",
        "--key"
      ],
      "dest": "key",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify a top-level key to look within for a list of objects to be converted when processing JSON."
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
      "help": "Display sheet names from the input Excel file."
    },
    {
      "optionStrings": [
        "--sheet"
      ],
      "dest": "sheet",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "The name of the Excel sheet to operate on."
    },
    {
      "optionStrings": [
        "--write-sheets"
      ],
      "dest": "write_sheets",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "The names of the Excel sheets to write to files, or \"-\" to write all sheets."
    },
    {
      "optionStrings": [
        "--use-sheet-names"
      ],
      "dest": "use_sheet_names",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Use the sheet names as file names when --write-sheets is set."
    },
    {
      "optionStrings": [
        "--reset-dimensions"
      ],
      "dest": "reset_dimensions",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": null,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Ignore the sheet dimensions provided by the XLSX file."
    },
    {
      "optionStrings": [
        "--encoding-xls"
      ],
      "dest": "encoding_xls",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify the encoding of the input XLS file."
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
      "help": "Disable type inference (and --locale, --date-format, --datetime-format, --no-leading-zeroes) when parsing CSV input."
    }
  ]
} satisfies CommandDescriptor;
