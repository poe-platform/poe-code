// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import type { Runtime } from "../runtime.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { emit, jsonTable, type JsonValue } from "../operations/json-table.js";
import { GeoJsonGenerator } from "../geojson/index.js";
import { readTable } from "../table/index.js";

async function json(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  if (o.lat && !o.lon) runtime.error("--lon is required whenever --lat is specified.");
  if (o.lon && !o.lat) runtime.error("--lat is required whenever --lon is specified.");
  for (const option of ["crs", "type", "geometry"]) if (o[option] && !o.lat) runtime.error(`--${option} is only allowed when --lat and --lon are also specified.`);
  const geo = Boolean(o.lat && o.lon);
  if (o.key && o.streamOutput && !geo) runtime.error("--key is only allowed with --stream when --lat and --lon are also specified.");
  const raw = Boolean(o.streamOutput && o.no_inference && o.sniff_limit === 0 && !o.skip_lines);
  if (raw && !runtime.input().codec.decodeStream) throw new CsvkitBlocked("incremental JSON input requires a streaming codec");
  if (runtime.context.terminal.stdinIsTTY && !o.input_path && !raw) runtime.error("You must provide an input file or piped data.");
  if (raw) await runtime.prompt();
  const indent = o.indent === null ? null : Math.max(0, Number(o.indent));
  if (indent !== null && (!Number.isSafeInteger(indent) || indent > runtime.context.limits.maxOutputBytes)) throw new CsvkitBlocked("JSON indentation budget exceeded");
  if (geo && indent !== null) runtime.retain(indent * 12);
  if (!raw) {
    if (!geo) return jsonTable(runtime, indent);
    const table = await readTable(runtime, undefined, undefined, true);
    const generator = new GeoJsonGenerator(runtime, table.headers, true);
    if (o.streamOutput) {
      for (const row of table.rows) { await emit(generator.feature(row), runtime, indent); await runtime.write("\n"); }
    } else await emit(generator.collection(table.rows), runtime, indent);
    return 0;
  }
  let headers: readonly string[] | undefined;
  let generator: GeoJsonGenerator | undefined;
  for await (const record of runtime.records()) {
    if (headers === undefined) { headers = record.cells; if (geo) generator = new GeoJsonGenerator(runtime, headers, false); continue; }
    let value: JsonValue;
    if (generator) value = generator.feature(record.cells);
    else {
      const fields = new Map<string, JsonValue>();
      runtime.retain(64 + headers.length * 64 + (indent ?? 0) * headers.length * 2);
      for (const [index, name] of headers.entries()) { runtime.step(); fields.set(name, record.cells[index] ?? null); }
      value = fields;
    }
    await emit(value, runtime, indent); await runtime.write("\n");
  }
  if (headers === undefined) throw new CsvkitDiagnostic("StopIteration: ");
  return 0;
}

export const csvjson = {
  execute: json,
  "name": "csvjson",
  "usage": "usage: csvjson [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [-i INDENT] [-k KEY] [--lat LAT]\n               [--lon LON] [--type TYPE] [--geometry GEOMETRY] [--crs CRS]\n               [--no-bbox] [--stream] [-y SNIFF_LIMIT] [-I]\n               [FILE]\n",
  "help": "usage: csvjson [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n               [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n               [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n               [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n               [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l]\n               [--add-bom] [--zero] [-V] [-i INDENT] [-k KEY] [--lat LAT]\n               [--lon LON] [--type TYPE] [--geometry GEOMETRY] [--crs CRS]\n               [--no-bbox] [--stream] [-y SNIFF_LIMIT] [-I]\n               [FILE]\n\nConvert a CSV file into JSON (or GeoJSON).\n\npositional arguments:\n  FILE                  The CSV file to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -L, --locale LOCALE   Specify the locale (en_US) of any formatted numbers.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  --blanks              Do not convert \"\", \"na\", \"n/a\", \"none\", \"null\", \".\" to\n                        NULL.\n  --null-value NULL_VALUES [NULL_VALUES ...]\n                        Convert this value to NULL. --null-value can be\n                        specified multiple times.\n  --date-format DATE_FORMAT\n                        Specify a strptime date format string like \"%m/%d/%Y\".\n  --datetime-format DATETIME_FORMAT\n                        Specify a strptime datetime format string like\n                        \"%m/%d/%Y %I:%M %p\".\n  --no-leading-zeroes   Do not convert a numeric value with leading zeroes to\n                        a number.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -i, --indent INDENT   Indent the output JSON this many spaces. Disabled by\n                        default.\n  -k, --key KEY         Output JSON as an object keyed by a given column, KEY,\n                        rather than as an array. All column values must be\n                        unique. If --lat and --lon are specified, this column\n                        is used as the GeoJSON Feature ID.\n  --lat LAT             A column index or name containing a latitude. Output\n                        will be GeoJSON instead of JSON. Requires --lon.\n  --lon LON             A column index or name containing a longitude. Output\n                        will be GeoJSON instead of JSON. Requires --lat.\n  --type TYPE           A column index or name containing a GeoJSON type.\n                        Output will be GeoJSON instead of JSON. Requires --lat\n                        and --lon.\n  --geometry GEOMETRY   A column index or name containing a GeoJSON geometry.\n                        Output will be GeoJSON instead of JSON. Requires --lat\n                        and --lon.\n  --crs CRS             A coordinate reference system string to be included\n                        with GeoJSON output. Requires --lat and --lon.\n  --no-bbox             Disable the calculation of a bounding box.\n  --stream              Output JSON as a stream of newline-separated objects,\n                        rather than an as an array.\n  -y, --snifflimit SNIFF_LIMIT\n                        Limit CSV dialect sniffing to the specified number of\n                        bytes. Specify \"0\" to disable sniffing entirely, or\n                        \"-1\" to sniff the entire file.\n  -I, --no-inference    Disable type inference (and --locale, --date-format,\n                        --datetime-format, --no-leading-zeroes) when parsing\n                        the input.\n",
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
      "help": "Output JSON as an object keyed by a given column, KEY, rather than as an array. All column values must be unique. If --lat and --lon are specified, this column is used as the GeoJSON Feature ID."
    },
    {
      "optionStrings": [
        "--lat"
      ],
      "dest": "lat",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A column index or name containing a latitude. Output will be GeoJSON instead of JSON. Requires --lon."
    },
    {
      "optionStrings": [
        "--lon"
      ],
      "dest": "lon",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A column index or name containing a longitude. Output will be GeoJSON instead of JSON. Requires --lat."
    },
    {
      "optionStrings": [
        "--type"
      ],
      "dest": "type",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A column index or name containing a GeoJSON type. Output will be GeoJSON instead of JSON. Requires --lat and --lon."
    },
    {
      "optionStrings": [
        "--geometry"
      ],
      "dest": "geometry",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A column index or name containing a GeoJSON geometry. Output will be GeoJSON instead of JSON. Requires --lat and --lon."
    },
    {
      "optionStrings": [
        "--crs"
      ],
      "dest": "crs",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A coordinate reference system string to be included with GeoJSON output. Requires --lat and --lon."
    },
    {
      "optionStrings": [
        "--no-bbox"
      ],
      "dest": "no_bbox",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Disable the calculation of a bounding box."
    },
    {
      "optionStrings": [
        "--stream"
      ],
      "dest": "streamOutput",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Output JSON as a stream of newline-separated objects, rather than an as an array."
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
