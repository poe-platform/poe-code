// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";
import { deriveSchema, compileCreateTable, identifier, schemaIdentifier } from "../sql/schema.js";
import type { Runtime } from "../runtime.js";
import type { DatabaseCell, DatabaseResult, DatabaseSession, SqlValue } from "../contracts.js";
import { readTable } from "../table/index.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { ResourceScope } from "../resources.js";
import { sqlOptions } from "../sql-options.js";
import { resolveDatabaseProvider } from '../database-url.js';
import { stripWhitespace, bytesRepr } from "../python-text.js";
import { virtualPath } from "../io/index.js";
import { fileException } from "../diagnostics/index.js";
import { databases } from "../databases.js";
import type { DatabaseDialectDescriptor } from "../databases/descriptor.js";

const reference = {
  execute: executeCsvsql,
  "name": "csvsql",
  "usage": "usage: csvsql [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n              [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n              [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n              [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom]\n              [--zero] [-V] [-i {mssql,mysql,oracle,postgresql,sqlite}]\n              [--db CONNECTION_STRING]\n              [--engine-option ENGINE_OPTION ENGINE_OPTION] [--query QUERIES]\n              [--insert] [--prefix PREFIX] [--before-insert BEFORE_INSERT]\n              [--after-insert AFTER_INSERT] [--sql-delimiter SQL_DELIMITER]\n              [--tables TABLE_NAMES] [--no-constraints]\n              [--unique-constraint UNIQUE_CONSTRAINT] [--no-create]\n              [--create-if-not-exists] [--overwrite] [--db-schema DB_SCHEMA]\n              [-y SNIFF_LIMIT] [-I] [--chunk-size CHUNK_SIZE]\n              [--min-col-len MIN_COL_LEN]\n              [--col-len-multiplier COL_LEN_MULTIPLIER]\n              [FILE ...]\n",
  "help": "usage: csvsql [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n              [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n              [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n              [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n              [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-l] [--add-bom]\n              [--zero] [-V] [-i {mssql,mysql,oracle,postgresql,sqlite}]\n              [--db CONNECTION_STRING]\n              [--engine-option ENGINE_OPTION ENGINE_OPTION] [--query QUERIES]\n              [--insert] [--prefix PREFIX] [--before-insert BEFORE_INSERT]\n              [--after-insert AFTER_INSERT] [--sql-delimiter SQL_DELIMITER]\n              [--tables TABLE_NAMES] [--no-constraints]\n              [--unique-constraint UNIQUE_CONSTRAINT] [--no-create]\n              [--create-if-not-exists] [--overwrite] [--db-schema DB_SCHEMA]\n              [-y SNIFF_LIMIT] [-I] [--chunk-size CHUNK_SIZE]\n              [--min-col-len MIN_COL_LEN]\n              [--col-len-multiplier COL_LEN_MULTIPLIER]\n              [FILE ...]\n\nGenerate SQL statements for one or more CSV files, or execute those statements\ndirectly on a database, and execute one or more SQL queries.\n\npositional arguments:\n  FILE                  The CSV file(s) to operate on. If omitted, will accept\n                        input as piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -d, --delimiter DELIMITER\n                        Delimiting character of the input CSV file.\n  -t, --tabs            Specify that the input CSV file is delimited with\n                        tabs. Overrides \"-d\".\n  -q, --quotechar QUOTECHAR\n                        Character used to quote strings in the input CSV file.\n  -u, --quoting {0,1,2,3,4,5}\n                        Quoting style used in the input CSV file: 0 quote\n                        minimal, 1 quote all, 2 quote non-numeric, 3 quote\n                        none.\n  -b, --no-doublequote  Whether or not double quotes are doubled in the input\n                        CSV file.\n  -p, --escapechar ESCAPECHAR\n                        Character used to escape the delimiter if --quoting 3\n                        (\"quote none\") is specified and to escape the\n                        QUOTECHAR if --no-doublequote is specified.\n  -z, --maxfieldsize FIELD_SIZE_LIMIT\n                        Maximum length of a single field in the input CSV\n                        file.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input CSV file.\n  -L, --locale LOCALE   Specify the locale (en_US) of any formatted numbers.\n  -S, --skipinitialspace\n                        Ignore whitespace immediately following the delimiter.\n  --blanks              Do not convert \"\", \"na\", \"n/a\", \"none\", \"null\", \".\" to\n                        NULL.\n  --null-value NULL_VALUES [NULL_VALUES ...]\n                        Convert this value to NULL. --null-value can be\n                        specified multiple times.\n  --date-format DATE_FORMAT\n                        Specify a strptime date format string like \"%m/%d/%Y\".\n  --datetime-format DATETIME_FORMAT\n                        Specify a strptime datetime format string like\n                        \"%m/%d/%Y %I:%M %p\".\n  --no-leading-zeroes   Do not convert a numeric value with leading zeroes to\n                        a number.\n  -H, --no-header-row   Specify that the input CSV file has no header row.\n                        Will create default headers (a,b,c,...).\n  -K, --skip-lines SKIP_LINES\n                        Specify the number of initial lines to skip before the\n                        header row (e.g. comments, copyright notices, empty\n                        rows).\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  --add-bom             Add the UTF-8 byte-order mark (BOM) to the output, for\n                        Excel compatibility\n  --zero                When interpreting or displaying column numbers, use\n                        zero-based numbering instead of the default 1-based\n                        numbering.\n  -V, --version         Display version information and exit.\n  -i, --dialect {mssql,mysql,oracle,postgresql,sqlite}\n                        Dialect of SQL to generate. Cannot be used with --db.\n  --db CONNECTION_STRING\n                        If present, a SQLAlchemy connection string to use to\n                        directly execute generated SQL on a database.\n  --engine-option ENGINE_OPTION ENGINE_OPTION\n                        A keyword argument to SQLAlchemy's create_engine(), as\n                        a space-separated pair. This option can be specified\n                        multiple times. For example: thick_mode True\n  --query QUERIES       Execute one or more SQL queries delimited by --sql-\n                        delimiter, and output the result of the last query as\n                        CSV. QUERY may be a filename. --query may be specified\n                        multiple times.\n  --insert              Insert the data into the table. Requires --db.\n  --prefix PREFIX       Add an expression following the INSERT keyword, like\n                        OR IGNORE or OR REPLACE.\n  --before-insert BEFORE_INSERT\n                        Before the INSERT command, execute one or more SQL\n                        queries delimited by --sql-delimiter. Requires\n                        --insert.\n  --after-insert AFTER_INSERT\n                        After the INSERT command, execute one or more SQL\n                        queries delimited by --sql-delimiter. Requires\n                        --insert.\n  --sql-delimiter SQL_DELIMITER\n                        Delimiter separating SQL queries in --query, --before-\n                        insert, and --after-insert.\n  --tables TABLE_NAMES  A comma-separated list of names of tables to be\n                        created. By default, the tables will be named after\n                        the filenames without extensions or \"stdin\".\n  --no-constraints      Generate a schema without length limits or null\n                        checks. Useful when sampling big tables.\n  --unique-constraint UNIQUE_CONSTRAINT\n                        A column-separated list of names of columns to include\n                        in a UNIQUE constraint.\n  --no-create           Skip creating the table. Requires --insert.\n  --create-if-not-exists\n                        Create the table if it does not exist, otherwise keep\n                        going. Requires --insert.\n  --overwrite           Drop the table if it already exists. Requires\n                        --insert. Cannot be used with --no-create.\n  --db-schema DB_SCHEMA\n                        Optional name of database schema to create table(s)\n                        in.\n  -y, --snifflimit SNIFF_LIMIT\n                        Limit CSV dialect sniffing to the specified number of\n                        bytes. Specify \"0\" to disable sniffing entirely, or\n                        \"-1\" to sniff the entire file.\n  -I, --no-inference    Disable type inference (and --locale, --date-format,\n                        --datetime-format, --no-leading-zeroes) when parsing\n                        the input.\n  --chunk-size CHUNK_SIZE\n                        Chunk size for batch insert into the table. Requires\n                        --insert.\n  --min-col-len MIN_COL_LEN\n                        The minimum length of text columns.\n  --col-len-multiplier COL_LEN_MULTIPLIER\n                        Multiply the maximum column length by this multiplier\n                        to accomodate larger values in later runs.\n",
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
      "help": "The CSV file(s) to operate on. If omitted, will accept input as piped data via STDIN."
    },
    {
      "optionStrings": [
        "-i",
        "--dialect"
      ],
      "dest": "dialect",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": databases.filter(provider => !provider.default).map(provider => provider.name),
      "metavar": null,
      "help": "Dialect of SQL to generate. Cannot be used with --db."
    },
    {
      "optionStrings": [
        "--db"
      ],
      "dest": "connection_string",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "If present, a SQLAlchemy connection string to use to directly execute generated SQL on a database."
    },
    {
      "optionStrings": [
        "--engine-option"
      ],
      "dest": "engine_option",
      "action": "_AppendAction",
      "nargs": 2,
      "default": [],
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A keyword argument to SQLAlchemy's create_engine(), as a space-separated pair. This option can be specified multiple times. For example: thick_mode True"
    },
    {
      "optionStrings": [
        "--query"
      ],
      "dest": "queries",
      "action": "_AppendAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Execute one or more SQL queries delimited by --sql-delimiter, and output the result of the last query as CSV. QUERY may be a filename. --query may be specified multiple times."
    },
    {
      "optionStrings": [
        "--insert"
      ],
      "dest": "insert",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Insert the data into the table. Requires --db."
    },
    {
      "optionStrings": [
        "--prefix"
      ],
      "dest": "prefix",
      "action": "_AppendAction",
      "nargs": null,
      "default": [],
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Add an expression following the INSERT keyword, like OR IGNORE or OR REPLACE."
    },
    {
      "optionStrings": [
        "--before-insert"
      ],
      "dest": "before_insert",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Before the INSERT command, execute one or more SQL queries delimited by --sql-delimiter. Requires --insert."
    },
    {
      "optionStrings": [
        "--after-insert"
      ],
      "dest": "after_insert",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "After the INSERT command, execute one or more SQL queries delimited by --sql-delimiter. Requires --insert."
    },
    {
      "optionStrings": [
        "--sql-delimiter"
      ],
      "dest": "sql_delimiter",
      "action": "_StoreAction",
      "nargs": null,
      "default": ";",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Delimiter separating SQL queries in --query, --before-insert, and --after-insert."
    },
    {
      "optionStrings": [
        "--tables"
      ],
      "dest": "table_names",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A comma-separated list of names of tables to be created. By default, the tables will be named after the filenames without extensions or \"stdin\"."
    },
    {
      "optionStrings": [
        "--no-constraints"
      ],
      "dest": "no_constraints",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Generate a schema without length limits or null checks. Useful when sampling big tables."
    },
    {
      "optionStrings": [
        "--unique-constraint"
      ],
      "dest": "unique_constraint",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A column-separated list of names of columns to include in a UNIQUE constraint."
    },
    {
      "optionStrings": [
        "--no-create"
      ],
      "dest": "no_create",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Skip creating the table. Requires --insert."
    },
    {
      "optionStrings": [
        "--create-if-not-exists"
      ],
      "dest": "create_if_not_exists",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Create the table if it does not exist, otherwise keep going. Requires --insert."
    },
    {
      "optionStrings": [
        "--overwrite"
      ],
      "dest": "overwrite",
      "action": "_StoreTrueAction",
      "nargs": 0,
      "default": false,
      "const": true,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Drop the table if it already exists. Requires --insert. Cannot be used with --no-create."
    },
    {
      "optionStrings": [
        "--db-schema"
      ],
      "dest": "db_schema",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Optional name of database schema to create table(s) in."
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
    },
    {
      "optionStrings": [
        "--chunk-size"
      ],
      "dest": "chunk_size",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "Chunk size for batch insert into the table. Requires --insert."
    },
    {
      "optionStrings": [
        "--min-col-len"
      ],
      "dest": "min_col_len",
      "action": "_StoreAction",
      "nargs": null,
      "default": 1,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "The minimum length of text columns."
    },
    {
      "optionStrings": [
        "--col-len-multiplier"
      ],
      "dest": "col_len_multiplier",
      "action": "_StoreAction",
      "nargs": null,
      "default": 1,
      "const": null,
      "required": false,
      "type": "builtins.int",
      "choices": null,
      "metavar": null,
      "help": "Multiply the maximum column length by this multiplier to accomodate larger values in later runs."
    }
  ]
} satisfies CommandDescriptor;

const choices = "{" + databases.filter(provider => !provider.default).map(provider => provider.name).join(",") + "}";
export const csvsql: CommandDescriptor = {
  ...reference,
  usage: reference.usage.replaceAll("{mssql,mysql,oracle,postgresql,sqlite}", choices),
  help: reference.help.replaceAll("{mssql,mysql,oracle,postgresql,sqlite}", choices),
};

/** Literal CSVSQL.main/_failsafe_main flow; capabilities never come from the host environment. */
async function executeCsvsql(runtime: Runtime): Promise<number> {
  const o = runtime.options, context = runtime.context;
  const paths = o.input_paths as readonly string[];
  if (context.terminal.stdinIsTTY && paths.length === 1 && paths[0] === '-') runtime.error('You must provide an input file or piped data.');
  const querying = Array.isArray(o.queries) && o.queries.length > 0;
  const connection = o.connection_string || (querying ? 'sqlite:///:memory:' : null);
  const insert = o.insert || Boolean(querying && !o.connection_string);
  if (o.dialect && connection) runtime.error('The --dialect option is only valid when neither --db nor --query are specified.');
  if (insert && !connection) runtime.error('The --insert option is only valid when either --db or --query is specified.');
  for (const [option, label] of [['no_create', 'no-create'], ['create_if_not_exists', 'create-if-not-exists'], ['overwrite', 'overwrite']] as const) {
    if (o[option] && !insert) runtime.error(`The --${label} option is only valid if --insert is also specified.`);
  }
  if (o.overwrite && o.no_create) runtime.error('The --overwrite option is only valid if --no-create is not specified.');
  for (const [option, label] of [['before_insert', 'before-insert'], ['after_insert', 'after-insert'], ['chunk_size', 'chunk-size']] as const) {
    if (o[option] && !insert) runtime.error(`The --${label} option is only valid if --insert is also specified.`);
  }
  if (o.no_create && o.create_if_not_exists) runtime.error('The --no-create and --create-if-not-exists options are mutually exclusive.');
  const names = o.table_names ? String(o.table_names).split(',') : [];
  const resources = new ResourceScope(context.signal, cleanup => context.registerCleanup(cleanup, 'invocation'));
  let committed = false, succeeded = false, failure: unknown;
  try {
    let session: DatabaseSession | undefined;
    let dialect: DatabaseDialectDescriptor | undefined = databases.find(binding => binding.name === o.dialect) ?? databases.find(binding => binding.default)!;
    if (connection) {
      runtime.sideEffects = true;
      const url = String(connection);
      const engineOptions = sqlOptions(o.engine_option as readonly (readonly [string, unknown])[], runtime.step.bind(runtime));
      const { provider, url: parsedUrl } = resolveDatabaseProvider(url, context.databases);
      session = await resources.acquire(() => provider.connect(url, engineOptions, context.signal, { cwd: context.cwd }), async session => {
        const errors: unknown[] = [];
        if (!committed) { try { await session.rollback(); } catch (error) { errors.push(error); } }
        try { await session.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'database session cleanup failed');
      });
      const dialectName = session.dialect ?? parsedUrl.dialect;
      const resolved = databases.find(binding => binding.name === dialectName) ?? context.sqlDialects?.find(binding => binding.name === dialectName);
      dialect = session.sqlDialect ?? resolved;
      // Driver work owns the session until it settles, including when caller
      // cancellation starts the resource scope's reverse cleanup.
      await resources.acquire(() => session!.begin(context.signal), async () => {});
    }
    const delimiter = String(o.sql_delimiter);
    const split = (sql: string): string[] => {
      if (!delimiter) throw new CsvkitDiagnostic('ValueError: empty separator');
      runtime.retain(sql.length * 4 + 64);
      return sql.split(delimiter);
    };
    const execute = async (sql: string, values: readonly SqlValue[] = []): Promise<DatabaseResult> => {
      runtime.step();
      runtime.retain(256 + values.length * 16);
      let closing: Promise<void> | undefined;
      const result = await resources.acquire(() => session!.query(sql, values, {}, context.signal), result => closing ??= result.close());
      return { columns: result.columns, rows: result.rows, close: () => closing ??= result.close() };
    };
    for (const [index, path] of paths.entries()) {
      runtime.step();
      const basename = path.slice(path.lastIndexOf('/') + 1), period = basename.lastIndexOf('.');
      const fileName = period > 0 && [...basename.slice(0, period)].some(char => char !== '.') ? basename.slice(0, period) : basename;
      const name = names[index] ?? (!path || path === '-' ? 'stdin' : fileName);
      const table = await readTable(runtime, path, undefined, true);
      if (!table.rows.length) continue;
      if (!dialect) throw new CsvkitBlocked('database DDL dialect metadata');
      if (!session) {
        await runtime.write(compileCreateTable(runtime, deriveSchema(runtime, table, name, dialect, false), dialect).statement.trim() + ';\n');
        continue;
      }
      if (o.before_insert) for (const sql of split(String(o.before_insert))) await (await execute(sql)).close();
      const qualified = (): string => (o.db_schema ? schemaIdentifier(String(o.db_schema), dialect, runtime) + '.' : '') + identifier(name, dialect, runtime);
      if (o.unique_constraint) {
        const missing = String(o.unique_constraint).split(',').find(column => !table.headers.includes(column));
        if (missing !== undefined) throw new CsvkitDiagnostic(`ConstraintColumnNotFoundError: Can't create UniqueConstraint on table '${name}': no column named '${missing}' is present.`);
      }
      if (!o.no_create) {
        if (o.overwrite) {
          if (!session.hasTable) throw new CsvkitBlocked('database table-existence capability');
          const exists = await resources.acquire(() => session!.hasTable!(name, o.db_schema ? String(o.db_schema) : null, context.signal), async () => {});
          runtime.step();
          if (exists) await (await execute('DROP TABLE ' + qualified())).close();
        }
        let create = true;
        if (o.create_if_not_exists) {
          if (!session.hasTable) throw new CsvkitBlocked('database table-existence capability');
          create = !await resources.acquire(() => session!.hasTable!(name, o.db_schema ? String(o.db_schema) : null, context.signal), async () => {});
          runtime.step();
        }
        if (create) await (await execute(compileCreateTable(runtime, deriveSchema(runtime, table, name, dialect, true), dialect).statement)).close();
      }
      if (insert) {
        if (o.chunk_size === 0 || o.chunk_size === 0n) throw new CsvkitDiagnostic('ZeroDivisionError: division by zero');
        const rowCount = BigInt(table.rows.length);
        const chunkSize = o.chunk_size === null ? rowCount : BigInt(o.chunk_size as number | bigint);
        const numerator = rowCount - 1n;
        const batchCount = numerator / chunkSize - (chunkSize < 0n && numerator % chunkSize !== 0n ? 1n : 0n) + 1n;
        const prefixes = (o.prefix as readonly string[]).join(' ');
        for (let batch = 0n; batch < batchCount; batch++) {
          runtime.step();
          const bind = dialect.bindValue;
          if (!bind || !(dialect.placeholder || dialect.parameter)) throw new CsvkitBlocked(`database insert driver profile ${dialect.name}`);
          const start = batch * chunkSize;
          const batchEnd = (batch + 1n) * chunkSize;
          const end = batchEnd > rowCount ? rowCount : batchEnd;
          const rows = table.rows.slice(Number(start), Number(end)).map(row => row.map(value => bind(value)));
          if (!rows.length) {
            await (await execute('INSERT ' + (prefixes ? prefixes + ' ' : '') + 'INTO ' + qualified() + ' DEFAULT VALUES')).close();
            continue;
          }
          const sql = 'INSERT ' + (prefixes ? prefixes + ' ' : '') + 'INTO ' + qualified() + ' (' + table.headers.map(header => identifier(header, dialect, runtime)).join(', ') + ') VALUES (' + table.headers.map((_, index) => dialect.parameter?.(index) ?? dialect.placeholder!).join(', ') + ')';
          runtime.retain(rows.length * (32 + table.headers.length * 16));
          if (session.executeMany) {
            let closing: Promise<void> | undefined;
            const result = await resources.acquire(() => session!.executeMany!(sql, rows, context.signal), result => closing ??= result.close());
            await (closing ??= result.close());
          } else for (const row of rows) await (await execute(sql, row)).close();
        }
      }
      if (o.after_insert) for (const sql of split(String(o.after_insert))) await (await execute(sql)).close();
    }
    if (session) {
      if (querying) {
        const queries: string[] = [];
        for (const query of o.queries as readonly string[]) {
          runtime.step();
          let text = query;
          const exists = context.fs.exists ? await context.fs.exists(virtualPath(context.cwd, query), { signal: context.signal }) : undefined;
          runtime.step();
          if (exists !== false) try {
            const bytes = await runtime.readFileBytes(query);
            runtime.step();
            if (bytes.byteLength > context.limits.maxInputBytes) throw new CsvkitBlocked('query file input byte budget exceeded');
            runtime.retain(bytes.byteLength * 4 + 64);
            const codec = context.codecs.find(binding => binding.names.includes('utf-8'));
            if (!codec) throw new CsvkitBlocked('query file UTF-8 codec');
            text = (await codec.decode(bytes, 'utf-8', context.signal)).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
          } catch (error) {
            context.signal.throwIfAborted();
            if (exists === true || !error || typeof error !== 'object' || !('code' in error) || !['ENOENT', 'ENOTDIR'].includes(String(error.code))) throw fileException(error, query);
          }
          queries.push(...split(text));
        }
        let last: DatabaseResult | undefined;
        for (const sql of queries) if (stripWhitespace(sql)) {
          await last?.close(); last = await execute(sql);
        }
        if (!last) throw new CsvkitDiagnostic("AttributeError: 'NoneType' object has no attribute 'returns_rows'");
        if (last.columns !== null) {
          await runtime.row(last.columns);
          let reading: Promise<IteratorResult<readonly DatabaseCell[]>> | undefined;
          let returning: Promise<void> | undefined;
          const releaseIterator = (iterator: AsyncIterator<readonly DatabaseCell[]>): Promise<void> => returning ??= (async () => {
            // return() may unblock next(), or finish before that read settles.
            // Request return immediately, then drain both before result disposal.
            const returning = Promise.resolve().then(() => iterator.return?.());
            await Promise.allSettled([reading, returning]);
            await returning;
          })();
          const iterator = await resources.acquire(async () => last.rows[Symbol.asyncIterator](), releaseIterator);
          let count = 0;
          while (true) {
            runtime.step();
            reading = Promise.resolve().then(() => iterator.next());
            const next = await reading;
            reading = undefined;
            runtime.step();
            if (next.done) break;
            if (++count > context.limits.maxDatabaseResultRows) throw new CsvkitBlocked('database result row budget exceeded');
            const row = next.value.map(value => {
              if (value instanceof Uint8Array) return bytesRepr(value);
              return value;
            });
            await runtime.row(row);
          }
          await releaseIterator(iterator);
        }
        await last.close();
      }
      runtime.step();
      await resources.acquire(async () => {
        await session!.commit(context.signal);
        committed = true;
      }, async () => {});
    }
    succeeded = true;
  } catch (caught) { failure = caught; }
  try { await resources.close(); } catch (cleanupFailure) { if (succeeded) throw cleanupFailure; }
  context.signal.throwIfAborted();
  if (!succeeded) throw failure;
  return 0;
}
