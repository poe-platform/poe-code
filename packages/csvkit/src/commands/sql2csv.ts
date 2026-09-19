import type { Runtime } from "../runtime.js";
import { CsvkitBlocked } from "../errors.js";
import { ResourceScope } from "../resources.js";
import { sqlOptions } from "../sql-options.js";
import { resolveDatabaseProvider } from '../database-url.js';
import { stripWhitespace, bytesRepr } from "../python-text.js";
import type { DatabaseCell } from "../contracts.js";

async function query(runtime: Runtime): Promise<number> {
  const o = runtime.options;
  const context = runtime.context;
  if (context.terminal.stdinIsTTY && !o.input_path && !o.query) runtime.error("You must provide an input file or piped data.");
  const url = String(o.connection_string);
  const engineOptions = sqlOptions(o.engine_option as readonly (readonly [string, unknown])[], runtime.step.bind(runtime));
  const { provider } = resolveDatabaseProvider(url, context.databases);
  const resources = new ResourceScope(context.signal, context.registerCleanup);
  let completed = false;
  let failure: unknown;
  try {
    const session = await resources.acquire(() => provider.connect(url, engineOptions, context.signal, { cwd: context.cwd }), async session => {
      const errors: unknown[] = [];
      try { await session.rollback(); } catch (error) { errors.push(error); }
      try { await session.close(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "database session cleanup failed");
    });
    if (o.query) runtime.retain(32 + String(o.query).length * 16);
    const sql = o.query ? stripWhitespace(String(o.query)) : await runtime.text();
    context.signal.throwIfAborted();
    const executionOptions: Record<string, unknown> = Object.assign(Object.create(null) as Record<string, unknown>,
      { no_parameters: true, stream_results: true }, sqlOptions(o.execution_option as readonly (readonly [string, unknown])[], runtime.step.bind(runtime)));
    const result = await resources.acquire(() => session.query(sql, [], executionOptions, context.signal), result => result.close());
    if (result.columns !== null) {
      if (!o.no_header_row) await runtime.row(result.columns);
      let reading: Promise<IteratorResult<readonly DatabaseCell[]>> | undefined;
      const iterator = await resources.acquire(async () => result.rows[Symbol.asyncIterator](), async iterator => {
        // Request return immediately to unblock cooperative reads, then drain
        // both operations before the owned result or connection can close.
        const returning = Promise.resolve().then(() => iterator.return?.());
        await Promise.allSettled([reading, returning]);
        await returning;
      });
      let count = 0;
      while (true) {
        runtime.step();
        reading = Promise.resolve().then(() => iterator.next());
        const next = await reading;
        reading = undefined;
        runtime.step();
        if (next.done) break;
        if (++count > context.limits.maxDatabaseResultRows) throw new CsvkitBlocked("database result row budget exceeded");
        const row = next.value.map(value => {
          if (value instanceof Uint8Array) return bytesRepr(value);
          return value;
        });
        await runtime.row(row);
      }
    }
    completed = true;
  } catch (caught) { failure = caught; }
  try { await resources.close(); } catch (cleanupFailure) { if (completed) throw cleanupFailure; }
  context.signal.throwIfAborted();
  if (!completed) throw failure;
  return 0;
}

// Grammar/help derived from csvkit 2.2.0; see LICENSE and docs/csvkit/reference-profile.json.
import type { CommandDescriptor } from "../descriptor.js";

export const sql2csv = {
  execute: query,
  "name": "sql2csv",
  "usage": "usage: sql2csv [-h] [-v] [-l] [-V] [--db CONNECTION_STRING]\n               [--engine-option ENGINE_OPTION ENGINE_OPTION]\n               [--execution-option EXECUTION_OPTION EXECUTION_OPTION]\n               [--query QUERY] [-e ENCODING] [-H]\n               [FILE]\n",
  "help": "usage: sql2csv [-h] [-v] [-l] [-V] [--db CONNECTION_STRING]\n               [--engine-option ENGINE_OPTION ENGINE_OPTION]\n               [--execution-option EXECUTION_OPTION EXECUTION_OPTION]\n               [--query QUERY] [-e ENCODING] [-H]\n               [FILE]\n\nExecute a SQL query on a database and output the result to a CSV file.\n\npositional arguments:\n  FILE                  The file to use as SQL query. If FILE and --query are\n                        omitted, the query is piped data via STDIN.\n\noptions:\n  -h, --help            show this help message and exit\n  -v, --verbose         Print detailed tracebacks when errors occur.\n  -l, --linenumbers     Insert a column of line numbers at the front of the\n                        output. Useful when piping to grep or as a simple\n                        primary key.\n  -V, --version         Display version information and exit.\n  --db CONNECTION_STRING\n                        A SQLAlchemy connection string to connect to a\n                        database.\n  --engine-option ENGINE_OPTION ENGINE_OPTION\n                        A keyword argument to SQLAlchemy's create_engine(), as\n                        a space-separated pair. This option can be specified\n                        multiple times. For example: thick_mode True\n  --execution-option EXECUTION_OPTION EXECUTION_OPTION\n                        A keyword argument to SQLAlchemy's\n                        execution_options(), as a space-separated pair. This\n                        option can be specified multiple times. For example:\n                        stream_results True\n  --query QUERY         The SQL query to execute. Overrides FILE and STDIN.\n  -e, --encoding ENCODING\n                        Specify the encoding of the input query file.\n  -H, --no-header-row   Do not output column names.\n",
  "defaults": {
    "delimiter": null,
    "doublequote": null,
    "escapechar": null,
    "encoding": "utf-8",
    "field_size_limit": null,
    "quotechar": null,
    "quoting": null,
    "skipinitialspace": null,
    "tabs": null
  },
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
        "--db"
      ],
      "dest": "connection_string",
      "action": "_StoreAction",
      "nargs": null,
      "default": "sqlite://",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A SQLAlchemy connection string to connect to a database."
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
        "--execution-option"
      ],
      "dest": "execution_option",
      "action": "_AppendAction",
      "nargs": 2,
      "default": [
        [
          "no_parameters",
          true
        ],
        [
          "stream_results",
          true
        ]
      ],
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "A keyword argument to SQLAlchemy's execution_options(), as a space-separated pair. This option can be specified multiple times. For example: stream_results True"
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
      "help": "The file to use as SQL query. If FILE and --query are omitted, the query is piped data via STDIN."
    },
    {
      "optionStrings": [
        "--query"
      ],
      "dest": "query",
      "action": "_StoreAction",
      "nargs": null,
      "default": null,
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "The SQL query to execute. Overrides FILE and STDIN."
    },
    {
      "optionStrings": [
        "-e",
        "--encoding"
      ],
      "dest": "encoding",
      "action": "_StoreAction",
      "nargs": null,
      "default": "utf-8",
      "const": null,
      "required": false,
      "type": null,
      "choices": null,
      "metavar": null,
      "help": "Specify the encoding of the input query file."
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
      "help": "Do not output column names."
    }
  ]
} satisfies CommandDescriptor;
