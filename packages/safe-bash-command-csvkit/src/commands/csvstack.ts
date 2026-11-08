// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { defaultHeaders } from "../columns.js";
import { DictionaryWriter, type CsvWriteCell } from "../csv.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";

/** Literal two-pass CSVStack flow: only the first file determines positional width. */
async function stack(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  const paths = o.input_paths as readonly string[];
  if (runtime.context.terminal.stdinIsTTY && paths.length === 1 && paths[0] === "-")
    await runtime.write("No input file or piped data provided. Waiting for standard input:\n", "stderr");
  const groups = o.groups === null || o.group_by_filenames ? undefined : String(o.groups).split(",");
  if (groups && groups.length !== paths.length)
    runtime.error("The number of grouping values must be equal to the number of CSV files being stacked.");
  const grouped = o.groups !== null || Boolean(o.group_by_filenames);
  const groupName = String(o.group_name || "group");
  const useFieldnames = !o.no_header_row;
  const headers: string[] = [];
  const seen = new Set<string>();
  let stdinHeaders: readonly string[] = [];
  let stdinFirst: readonly string[] = [];
  for (const path of paths) {
    const reader = runtime.records(path);
    let first;
    try { first = await reader.next(); } finally { await reader.return(undefined); }
    const row = first.done ? [] : first.value.cells;
    const names = useFieldnames ? row : defaultHeaders(row.length);
    for (const name of names) {
      runtime.step();
      if (!seen.has(name)) {
        runtime.retain(64 + name.length * 2);
        seen.add(name);
        headers.push(name);
      }
    }
    if (path === "-") {
      if (useFieldnames) stdinHeaders = names;
      else stdinFirst = row;
    }
    if (!useFieldnames) break;
  }
  if (grouped) headers.unshift(groupName);
  if (headers.length + (o.line_numbers ? 1 : 0) > runtime.context.limits.maxColumns)
    throw new CsvkitBlocked("output column budget exceeded");
  const output = useFieldnames ? new DictionaryWriter(headers, { lineNumbers: Boolean(o.line_numbers) }) : undefined;
  if (output) await runtime.write(output.writeheader());
  else await runtime.row(headers);
  for (const [index, path] of paths.entries()) {
    const file = runtime.input(path, true);
    const group = groups?.[index] ?? file.name.split("/").at(-1)!;
    let names: readonly string[] | undefined = path === "-" ? stdinHeaders : undefined;
    try {
      // This cached positional stdin row intentionally bypasses grouping, as in 2.2.0.
      if (path === "-" && stdinFirst.length) await runtime.row(stdinFirst);
      for await (const record of runtime.records(path, file, path === "-" ? 0 : Number(o.skip_lines ?? 0))) {
        const cells = record.cells;
        runtime.step();
        if (!useFieldnames) {
          await runtime.row(grouped ? [group, ...cells] : cells);
          continue;
        }
        if (names === undefined) { names = cells; continue; }
        // DictReader skips empty records and stores surplus cells under the None key.
        if (!cells.length) continue;
        if (cells.length > names.length)
          throw new CsvkitDiagnostic("ValueError: dict contains fields not in fieldnames: None");
        const row: Record<string, CsvWriteCell> = Object.create(null) as Record<string, CsvWriteCell>;
        for (const [position, name] of names.entries()) {
          runtime.step();
          row[name] = cells[position] ?? null;
        }
        if (grouped) row[groupName] = group;
        await runtime.write(output!.writerow(row));
      }
    } finally { await file.close(); }
  }
  return 0;
}

export const csvstack = {
  execute: stack,
  "name": "csvstack",
  "usage": "usage: csvstack [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]\n                [-b] [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S]\n                [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V]\n                [-g GROUPS] [-n GROUP_NAME] [--filenames]\n                [FILE ...]\n",
  "help": "usage: csvstack [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}]\n                [-b] [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-S]\n                [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom] [--zero] [-V]\n                [-g GROUPS] [-n GROUP_NAME] [--filenames]\n                [FILE ...]\n\nStack up the rows from multiple CSV files, optionally adding a grouping value.\n\npositional arguments:\n  FILE                  The CSV file(s) to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -g, --groups GROUPS   A comma-separated list of values to add as \"grouping\n                        factors\", one per CSV being stacked. These are added\n                        to the output as a new column. You may specify a name\n                        for the new column using the -n flag.\n  -n, --group-name GROUP_NAME\n                        A name for the grouping column, e.g. \"year\". Only used\n                        when also specifying -g.\n  --filenames           Use the filename of each input file as its grouping\n                        value. When specified, -g will be ignored.\n",
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
      "help": "The CSV file(s) to operate on. If omitted, will accept input as piped data via STDIN."
    },
    {
      "optionStrings": [
        "-g",
        "--groups"
      ],
      "dest": "groups",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A comma-separated list of values to add as \"grouping factors\", one per CSV being stacked. These are added to the output as a new column. You may specify a name for the new column using the -n flag."
    },
    {
      "optionStrings": [
        "-n",
        "--group-name"
      ],
      "dest": "group_name",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A name for the grouping column, e.g. \"year\". Only used when also specifying -g."
    },
    {
      "optionStrings": [
        "--filenames"
      ],
      "dest": "group_by_filenames",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Use the filename of each input file as its grouping value. When specified, -g will be ignored."
    }
  ]
} satisfies CommandDescriptor;
