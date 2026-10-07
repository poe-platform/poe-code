import {formatQueryParts, type QueryOutputOptions} from "./query-output.js";
import {encodeOutput, formatSqlQuote, publishSqliteOutput, sqlQuoteParts} from "./stream-output.js";
import { CsvRows } from "./csv-rows.js";
import { retainInput } from "./retained-input.js";
import { readFileStream } from "safe-bash-contracts/filesystem";
import { stagedScriptLines } from "./script-lines.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
  writeText,
  writeBytes,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import {
  SqliteDatabase,
  matchGlob, matchLike,
  splitSqlStatements, tokenizeSql,
  type QueryResultSet,
  type SqlValue
} from "./engine.js";

export interface Sqlite3Limits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRows: number;
}

export interface SqliteEngineInstance {
  executeStatementAsync?(sql: string, signal: AbortSignal): Promise<QueryResultSet | null>;
  executeStatement?(sql: string, positionalParams?: SqlValue[]): Promise<QueryResultSet | null> | QueryResultSet | null;
  exec?(sql: string, positionalParams?: SqlValue[]): Promise<QueryResultSet[]> | QueryResultSet[];
  loadFromBytes?(bytes: Uint8Array): Promise<void> | void;
  serializeToBytes?(): Promise<Uint8Array> | Uint8Array;
  readonly tables?: Map<string, { name: string; sql: string; columns: { name: string }[]; rows: { data: Record<string, SqlValue> }[] }> | undefined;
  readonly indexes?: Map<string, { name: string; tableName: string; sql: string }> | undefined;
  readonly views?: Map<string, { name: string; sql: string }> | undefined;
  readonly triggers?: Map<string, { name: string; tableName: string; sql: string }> | undefined;
  readonly parameters?: Map<string, SqlValue> | undefined;
  readonly inTransaction?: boolean | undefined;
  readonly lastChanges?: number | undefined;
  readonly totalChanges?: number | undefined;
  findTable?(name: string): { name: string; sql: string; columns: { name: string }[]; rows: { data: Record<string, SqlValue> }[] } | undefined;
}

export interface CloudflareSqlStorageCursor {
  readonly columnNames?: readonly string[] | undefined;
  raw?(): Iterable<readonly unknown[]>;
  toArray?(): readonly Record<string, unknown>[];
  [Symbol.iterator]?(): Iterator<Record<string, unknown>>;
}

export interface CloudflareSqlStorage {
  exec(query: string, ...bindings: unknown[]): CloudflareSqlStorageCursor | Promise<CloudflareSqlStorageCursor>;
}

export interface CloudflareD1PreparedStatement {
  bind?(...values: unknown[]): CloudflareD1PreparedStatement;
  raw?(options?: { columnNames?: boolean }): Promise<unknown[][]>;
  all?(): Promise<{ results?: Record<string, unknown>[] }>;
  run?(): Promise<unknown>;
}

export interface CloudflareD1Database {
  prepare(query: string): CloudflareD1PreparedStatement;
}

export type InjectableSqliteEngine =
  | SqliteEngineInstance
  | CloudflareSqlStorage
  | CloudflareD1Database;

export type SqliteEngineFactory = (options: {
  readonly dbPath: string;
  readonly readonly: boolean;
  readonly context: CommandContext;
}) => Promise<InjectableSqliteEngine> | InjectableSqliteEngine;

export interface Sqlite3CommandsOptions {
  readonly replace?: boolean | undefined;
  readonly limits?: Partial<Sqlite3Limits> | undefined;
  readonly engine?: SqliteEngineFactory | InjectableSqliteEngine | undefined;
}

export type Sqlite3Options = Sqlite3CommandsOptions;

type OutputMode = QueryOutputOptions["mode"];

interface CliSessionState extends QueryOutputOptions {
  bail: boolean;
  echo: boolean;
  changes: boolean;
  readonly: boolean;
  outputFile: string | null;
  onceFile: string | null;
  dbPath: string;
  dirty: boolean;
  exitRequested: boolean;
  exitCode: number;
}

function setOutputMode(state: CliSessionState, mode: string, argument?: string): void {
  if (!["list", "csv", "column", "line", "json", "tabs", "html", "markdown", "box", "table", "quote", "ascii", "insert"].includes(mode)) {
    return;
  }
  state.mode = mode as OutputMode;
  switch (mode) {
    case "list":
      state.colSeparator = "|";
      state.rowSeparator = "\n";
      break;
    case "csv":
      state.colSeparator = ",";
      state.rowSeparator = "\r\n";
      break;
    case "tabs":
      state.colSeparator = "\t";
      break;
    case "ascii":
      state.colSeparator = "\x1f";
      state.rowSeparator = "\x1e";
      break;
    case "quote":
      state.colSeparator = ",";
      state.rowSeparator = "\n";
      break;
    case "line":
    case "column":
      state.rowSeparator = "\n";
      break;
    case "insert":
      if (argument) state.insertTable = argument;
      break;
    case "table":
    case "box":
    case "markdown":
      if (argument === undefined) state.showHeaders = true;
      break;
  }
}

const textEncoder = new TextEncoder();

async function vfsExists(fs: CommandContext["fs"], path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

function resolveVfsPath(cwd: string, p: string): string {
  if (!p || p === ":memory:") {
    return ":memory:";
  }
  if (p.startsWith("/")) {
    return p;
  }
  return `${cwd === "/" ? "" : cwd}/${p}`;
}


function coerceInjectedSqlValue(v: unknown): SqlValue {
  if (v === null || v === undefined) {
    return null;
  }
  if (
    typeof v === "number" ||
    typeof v === "bigint" ||
    typeof v === "string" ||
    v instanceof Number ||
    v instanceof Uint8Array
  ) {
    return v;
  }
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  if (v instanceof ArrayBuffer) {
    return new Uint8Array(v);
  }
  if (ArrayBuffer.isView(v)) {
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return String(v);
}

function normalizeInjectedEngine(raw: InjectableSqliteEngine): SqliteEngineInstance {
  const candidate = raw as SqliteEngineInstance & Partial<CloudflareD1Database> & Partial<CloudflareSqlStorage>;
  if (typeof candidate.executeStatement === "function") {
    return candidate;
  }
  if (typeof candidate.prepare === "function") {
    const d1 = candidate as CloudflareD1Database;
    return {
      async executeStatement(sql: string, positionalParams?: SqlValue[]): Promise<QueryResultSet | null> {
        let stmt = d1.prepare(sql);
        if (positionalParams && positionalParams.length > 0 && typeof stmt.bind === "function") {
          stmt = stmt.bind(...positionalParams);
        }
        const isReturningOrQuery = /^\s*(SELECT|PRAGMA|WITH|VALUES|EXPLAIN)\b|\bRETURNING\b/i.test(sql);
        if (!isReturningOrQuery && typeof stmt.run === "function") {
          await stmt.run();
          return null;
        }
        if (typeof stmt.raw === "function") {
          const rawRows = await stmt.raw({ columnNames: true });
          if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return { columns: [], rows: [] };
          }
          const first = rawRows[0];
          if (Array.isArray(first) && first.every((c) => typeof c === "string")) {
            const columns = first as string[];
            const rows = rawRows.slice(1).map((r) => (Array.isArray(r) ? r.map(coerceInjectedSqlValue) : []));
            return { columns, rows };
          }
        }
        if (typeof stmt.all === "function") {
          const res = await stmt.all();
          const objs = res?.results ?? [];
          if (objs.length === 0) {
            return { columns: [], rows: [] };
          }
          const columns = Object.keys(objs[0]!);
          const rows = objs.map((o) => columns.map((c) => coerceInjectedSqlValue(o[c])));
          return { columns, rows };
        }
        if (typeof stmt.run === "function") {
          await stmt.run();
        }
        return null;
      }
    };
  }
  if (typeof candidate.exec === "function") {
    return {
      ...candidate,
      async executeStatement(sql: string, positionalParams?: SqlValue[]): Promise<QueryResultSet | null> {
        const ret = await (candidate.exec as (...a: unknown[]) => unknown)(sql, ...(positionalParams ?? []));
        if (ret === null || ret === undefined) {
          return null;
        }
        if (Array.isArray(ret)) {
          const sets = ret as QueryResultSet[];
          return sets[sets.length - 1] ?? null;
        }
        const cursor = ret as CloudflareSqlStorageCursor;
        if (Array.isArray(cursor.columnNames) && typeof cursor.raw === "function") {
          const columns = [...cursor.columnNames];
          const rows = Array.from(cursor.raw(), (r) => Array.from(r, coerceInjectedSqlValue));
          return columns.length === 0 && rows.length === 0 ? null : { columns, rows };
        }
        if (typeof cursor.toArray === "function") {
          const objs = cursor.toArray();
          const columns = Array.isArray(cursor.columnNames)
            ? [...cursor.columnNames]
            : objs.length > 0
              ? Object.keys(objs[0]!)
              : [];
          const rows = objs.map((o) => columns.map((c) => coerceInjectedSqlValue(o[c])));
          return columns.length === 0 && rows.length === 0 ? null : { columns, rows };
        }
        if (typeof cursor[Symbol.iterator] === "function") {
          const objs = Array.from(cursor as Iterable<Record<string, unknown>>);
          const columns = Array.isArray(cursor.columnNames)
            ? [...cursor.columnNames]
            : objs.length > 0
              ? Object.keys(objs[0]!)
              : [];
          const rows = objs.map((o) => columns.map((c) => coerceInjectedSqlValue(o[c])));
          return columns.length === 0 && rows.length === 0 ? null : { columns, rows };
        }
        return null;
      }
    };
  }
  return candidate;
}

function parseCsvContent(content: string, separator: string): string[][] {
  return [...new CsvRows(separator).push(content, true)];
}

function splitDotCommandArgs(line: string): string[] {
  const args: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) {
      i += 1;
    }
    if (i >= line.length) {
      break;
    }
    const ch = line[i]!;
    if (ch === '"' || ch === "'") {
      const q = ch;
      i += 1;
      let val = "";
      while (i < line.length && line[i] !== q) {
        if (line[i] === "\\" && i + 1 < line.length) {
          const next = line[i + 1]!;
          if (next === "n") {
            val += "\n";
          } else if (next === "t") {
            val += "\t";
          } else {
            val += next;
          }
          i += 2;
          continue;
        }
        val += line[i]!;
        i += 1;
      }
      i += 1;
      args.push(val);
    } else {
      let val = "";
      while (i < line.length && !/\s/.test(line[i]!)) {
        val += line[i]!;
        i += 1;
      }
      args.push(val);
    }
  }
  return args;
}

function isMutatingStatement(sql: string): boolean {
  const tokens = tokenizeSql(sql);
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "punct" && token.value === "(") { depth++; continue; }
    if (token.type === "punct" && token.value === ")") { depth--; continue; }
    if (depth !== 0 || token.type !== "word") continue;
    const word = token.value.toUpperCase();
    if (["CREATE", "DROP", "ALTER", "INSERT", "REPLACE", "UPDATE", "DELETE", "VACUUM", "REINDEX", "ANALYZE"].includes(word)) return true;
    if (word === "PRAGMA") return tokens.some((item) => item.value === "=" || item.value === "(");
    if (["SELECT", "VALUES", "EXPLAIN"].includes(word)) return false;
  }
  return false;
}

export const settings = {
  commandName: "sqlite3",
  limits: {
    maxInputBytes: Infinity,
    maxOutputBytes: Infinity,
    maxRows: Infinity
  } satisfies Sqlite3Limits
} as const;

export function createSqlite3Command(options: Sqlite3CommandsOptions = {}): CommandDefinition {
  const limits = { ...settings.limits, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`${name} must be a nonnegative safe integer or Infinity`);
    }
  }
  return {
    name: settings.commandName,
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context: CommandContext): Promise<CommandResult> {
    const state: CliSessionState = {
      mode: "list",
      insertTable: "table",
      showHeaders: false,
      colSeparator: "|",
      rowSeparator: "\n",
      nullValue: "",
      bail: false,
      echo: false,
      changes: false,
      readonly: false,
      widths: [],
      outputFile: null,
      onceFile: null,
      dbPath: ":memory:",
      dirty: false,
      exitRequested: false,
      exitCode: 0
    };

    let inputBytes = 0;
    let outputBytes = 0;
    let limitExceeded = false;
    const enforceLimit = (name: keyof Sqlite3Limits, size: number) => {
      if (size > limits[name]) {
        limitExceeded = true;
        state.exitRequested = true;
        throw new RangeError(`${name} limit exceeded`);
      }
    };
    const readInputFile = async (path: string): Promise<Uint8Array> => {
      const remaining = limits.maxInputBytes - inputBytes;
      enforceLimit("maxInputBytes", inputBytes + (await context.fs.stat(path)).size);
      const bytes = await context.fs.readFile(path, { ...(remaining === Infinity ? {} : { maxBytes: remaining }), signal: context.signal });
      inputBytes += bytes.byteLength;
      enforceLimit("maxInputBytes", inputBytes);
      return bytes;
    };
    const checkTableRows = (engine: SqliteEngineInstance) => {
      let rows = 0;
      for (const table of engine.tables?.values() ?? []) {
        rows += table.rows.length;
        enforceLimit("maxRows", rows);
      }
    };
    const countOutput = (bytes: number) => {
      enforceLimit("maxOutputBytes", outputBytes + bytes);
      outputBytes += bytes;
    };

    const writeStdout = async (text: string) => {
      countOutput(textEncoder.encode(text).byteLength);
      await writeText(context.stdout, text);
    };

    try {
    const preCommands: string[] = [];
    let initFile: string | null = null;
    const positional: string[] = [];

    const args = context.args;
    let i = 0;
    while (i < args.length) {
      const arg = args[i]!;
      if (arg === "--") {
        positional.push(...args.slice(i + 1));
        break;
      }
      if (arg === "-version" || arg === "--version") {
        await writeStdout(
          "3.45.0 2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d\n"
        );
        return { exitCode: 0 };
      }
      if (arg === "-help" || arg === "--help") {
        await writeStdout(
          "Usage: sqlite3 [OPTIONS] FILENAME [SQL]\nOptions:\n  -bail                stop after hitting an error\n  -batch               force batch I/O\n  -box                 set output mode to 'box'\n  -column              set output mode to 'column'\n  -cmd COMMAND         run \"COMMAND\" before reading stdin\n  -csv                 set output mode to 'csv'\n  -echo                print inputs before execution\n  -header              turn headers on\n  -noheader            turn headers off\n  -html                set output mode to HTML\n  -init FILENAME       read/process named file\n  -json                set output mode to 'json'\n  -line                set output mode to 'line'\n  -list                set output mode to 'list'\n  -markdown            set output mode to 'markdown'\n  -nullvalue TEXT      set text string for NULL values\n  -quote               set output mode to 'quote'\n  -readonly            open the database read-only\n  -separator SEP       set output column separator\n  -table               set output mode to 'table'\n  -tabs                set output mode to 'tabs'\n  -version             show SQLite version\n"
        );
        return { exitCode: 0 };
      }
      if (arg === "-csv" || arg === "--csv") {
        state.mode = "csv";
        state.colSeparator = ",";
      } else if (arg === "-json" || arg === "--json") {
        state.mode = "json";
      } else if (arg === "-line" || arg === "--line") {
        state.mode = "line";
      } else if (arg === "-list" || arg === "--list") {
        state.mode = "list";
        state.colSeparator = "|";
      } else if (arg === "-column" || arg === "--column") {
        state.mode = "column";
      } else if (arg === "-table" || arg === "--table") {
        state.mode = "table";
        state.showHeaders = true;
      } else if (arg === "-box" || arg === "--box") {
        state.mode = "box";
        state.showHeaders = true;
      } else if (arg === "-markdown" || arg === "--markdown") {
        state.mode = "markdown";
        state.showHeaders = true;
      } else if (arg === "-quote" || arg === "--quote") {
        state.mode = "quote";
      } else if (arg === "-tabs" || arg === "--tabs") {
        state.mode = "tabs";
        state.colSeparator = "\t";
      } else if (arg === "-html" || arg === "--html") {
        state.mode = "html";
      } else if (arg === "-ascii" || arg === "--ascii") {
        state.mode = "ascii";
        state.colSeparator = "\x1f";
        state.rowSeparator = "\x1e";
      } else if (arg === "-header" || arg === "--header") {
        state.showHeaders = true;
      } else if (arg === "-noheader" || arg === "--noheader") {
        state.showHeaders = false;
      } else if (arg === "-bail" || arg === "--bail") {
        state.bail = true;
      } else if (arg === "-echo" || arg === "--echo") {
        state.echo = true;
      } else if (arg === "-readonly" || arg === "--readonly") {
        state.readonly = true;
      } else if (arg === "-batch" || arg === "--batch" || arg === "-interactive" || arg === "--interactive") {
        // Accepted flags
      } else if (arg === "-separator" || arg === "--separator") {
        state.colSeparator = args[i + 1] ?? "|";
        i += 1;
      } else if (arg === "-nullvalue" || arg === "--nullvalue") {
        state.nullValue = args[i + 1] ?? "";
        i += 1;
      } else if (arg === "-cmd" || arg === "--cmd") {
        if (args[i + 1] !== undefined) {
          preCommands.push(args[i + 1]!);
        }
        i += 1;
      } else if (arg === "-init" || arg === "--init") {
        initFile = args[i + 1] ?? null;
        i += 1;
      } else if (arg.startsWith("-") && positional.length === 0) {
        await writeText(context.stderr, `sqlite3: Error: unknown option: ${arg}\n`);
        return { exitCode: 1 };
      } else {
        positional.push(arg);
      }
      i += 1;
    }

    if (positional.length > 0 && positional[0] !== "") {
      state.dbPath = resolveVfsPath(context.cwd, positional[0]!);
    }

    const createDbInstance = async (dbPath: string, readonly: boolean): Promise<SqliteEngineInstance> => {
      if (options?.engine) {
        const raw = typeof options.engine === "function"
          ? await options.engine({ dbPath, readonly, context })
          : options.engine;
        return normalizeInjectedEngine(raw);
      }
      return new SqliteDatabase(limits.maxRows);
    };

    const db: SqliteEngineInstance = await createDbInstance(state.dbPath, state.readonly);

    const execSingleStmt = async (stmt: string): Promise<QueryResultSet | null> => {
      await yieldTurn(context.signal);
      let sets: QueryResultSet[] = [];
      try {
        if (typeof db.executeStatement === "function") {
          const result = await (db.executeStatementAsync
            ? db.executeStatementAsync(stmt, context.signal)
            : db.executeStatement(stmt));
          if (result) sets = [result];
        } else if (typeof db.exec === "function") {
          sets = await db.exec(stmt);
        }
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof RangeError && error.message === "maxRows limit exceeded") enforceLimit("maxRows", Infinity);
        throw error;
      }
      for (const result of sets) enforceLimit("maxRows", result.rows.length);
      checkTableRows(db);
      if (!db.tables && limits.maxRows !== Infinity) {
        const query = async (sql: string): Promise<QueryResultSet | null> => {
          if (db.executeStatement) return await db.executeStatement(sql);
          const results = await db.exec?.(sql);
          return results?.[results.length - 1] ?? null;
        };
        const tables = await query("SELECT name FROM sqlite_master WHERE type='table';");
        let rows = 0;
        for (const [name] of tables?.rows ?? []) {
          const count = await query(`SELECT COUNT(*) FROM "${String(name).replaceAll('"', '""')}";`);
          rows += Number(count?.rows[0]?.[0] ?? 0);
          enforceLimit("maxRows", rows);
        }
      }
      return sets[sets.length - 1] ?? null;
    };

    const loadDbFromDisk = async (path: string) => {
      if (path === ":memory:") {
        return;
      }
      try {
        if (await vfsExists(context.fs, path)) {
          const bytes = await readInputFile(path);
          if (typeof db.loadFromBytes === "function") {
            await db.loadFromBytes(bytes);
            checkTableRows(db);
          } else if (bytes.byteLength > 0) {
            const tempDb = new SqliteDatabase();
            tempDb.loadFromBytes(bytes);
            checkTableRows(tempDb);
            for (const tbl of tempDb.tables.values()) {
              if (tbl.sql) {
                await execSingleStmt(tbl.sql);
              }
              const colNames = tbl.columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(", ");
              for (const r of tbl.rows) {
                const vals = tbl.columns.map((c) => formatSqlQuote(r.data[c.name] ?? null)).join(", ");
                await execSingleStmt(`INSERT INTO "${tbl.name.replace(/"/g, '""')}" (${colNames}) VALUES (${vals});`);
              }
            }
            for (const idx of tempDb.indexes.values()) {
              if (idx.sql) {
                await execSingleStmt(idx.sql);
              }
            }
            for (const v of tempDb.views.values()) {
              if (v.sql) {
                await execSingleStmt(v.sql);
              }
            }
            for (const tr of tempDb.triggers.values()) {
              if (tr.sql) {
                await execSingleStmt(tr.sql);
              }
            }
          }
        }
      } catch (err) {
        context.signal.throwIfAborted();
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Error: in prepare, ${msg}`);
      }
    };

    const saveDbToDisk = async (path: string) => {
      if (path === ":memory:" || state.readonly) {
        return;
      }
      if (typeof db.serializeToBytes === "function") {
        const bytes = await db.serializeToBytes();
        countOutput(bytes.byteLength);
        await writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, { signal: context.signal }));
      } else {
        const tempDb = new SqliteDatabase();
        const masterRes = await execSingleStmt(
          "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'view' THEN 3 ELSE 4 END;"
        );
        for (const row of masterRes?.rows ?? []) {
          const sql = String(row[3] ?? "");
          if (sql) {
            try {
              tempDb.exec(sql);
            } catch {
              // Ignore unsupported DDL
            }
          }
        }
        for (const tbl of tempDb.tables.values()) {
          const rowsRes = await execSingleStmt(`SELECT * FROM "${tbl.name.replace(/"/g, '""')}";`);
          const colNames = (rowsRes?.columns ?? tbl.columns.map((c) => c.name))
            .map((c) => `"${c.replace(/"/g, '""')}"`)
            .join(", ");
          for (const r of rowsRes?.rows ?? []) {
            const vals = r.map((v) => formatSqlQuote(v ?? null)).join(", ");
            tempDb.exec(`INSERT INTO "${tbl.name.replace(/"/g, '""')}" (${colNames}) VALUES (${vals});`);
          }
        }
        const bytes = tempDb.serializeToBytes();
        countOutput(bytes.byteLength);
        await writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, { signal: context.signal }));
      }
    };

    try {
      await loadDbFromDisk(state.dbPath);
    } catch (err) {
      context.signal.throwIfAborted();
      await writeText(context.stderr, `${err instanceof Error ? err.message : String(err)}\n`);
      return { exitCode: 1 };
    }

    const emitOutput = async (text: string | Iterable<string> | AsyncIterable<string>) => {
      if (text === "") return;
      const retained = await retainInput(encodeOutput(typeof text === "string" ? [text] : text, context.signal), context, countOutput);
      let failed = false;
      try {
        if (!retained.size) return;
        if (state.onceFile) {
          const target = resolveVfsPath(context.cwd, state.onceFile);
          state.onceFile = null;
          await publishSqliteOutput(context, target, retained.bytes());
        } else if (state.outputFile && state.outputFile !== "stdout") {
          await publishSqliteOutput(context, resolveVfsPath(context.cwd, state.outputFile), retained.bytes(), true);
        } else for await (const bytes of retained.bytes()) await writeBytes(context.stdout, bytes, context.signal);
      } catch (error) { failed = true; throw error; }
      finally { await retained.close().catch(error => { if (!failed) throw error; }); }
    };

    const executeDotCommand = async (line: string): Promise<void> => {
      const parts = splitDotCommandArgs(line);
      const cmd = (parts[0] ?? "").toLowerCase();

      if (cmd === ".quit" || cmd === ".exit" || cmd === ".q") {
        state.exitRequested = true;
        if (parts[1] !== undefined) {
          state.exitCode = Number(parts[1]) || 0;
        }
        return;
      }

      if (cmd === ".mode") {
        setOutputMode(state, (parts[1] ?? "list").toLowerCase(), parts[2]);
        return;
      }

      if (cmd === ".headers" || cmd === ".header") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.showHeaders = val === "on" || val === "1" || val === "true" || val === "yes";
        return;
      }

      if (cmd === ".separator") {
        if (parts[1] !== undefined) {
          state.colSeparator = parts[1];
        }
        if (parts[2] !== undefined) {
          state.rowSeparator = parts[2];
        }
        return;
      }

      if (cmd === ".nullvalue") {
        state.nullValue = parts[1] ?? "";
        return;
      }

      if (cmd === ".width") {
        state.widths = parts.slice(1).map((x) => Number(x) || 0);
        return;
      }

      if (cmd === ".print") {
        await emitOutput(`${parts.slice(1).join(" ")}\n`);
        return;
      }

      if (cmd === ".echo") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.echo = val === "on" || val === "1" || val === "true";
        return;
      }

      if (cmd === ".bail") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.bail = val === "on" || val === "1" || val === "true";
        return;
      }

      if (cmd === ".changes") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.changes = val === "on" || val === "1" || val === "true";
        return;
      }

      if (cmd === ".show") {
        const info = [
          `        echo: ${state.echo ? "on" : "off"}`,
          `     headers: ${state.showHeaders ? "on" : "off"}`,
          `        mode: ${state.mode}`,
          `   nullvalue: "${state.nullValue}"`,
          `      output: ${state.outputFile ?? "stdout"}`,
          `colseparator: "${state.colSeparator}"`,
          `rowseparator: "${state.rowSeparator === "\n" ? "\\n" : state.rowSeparator}"`
        ].join("\n");
        await emitOutput(`${info}\n`);
        return;
      }

      if (cmd === ".output" || cmd === ".out") {
        const target = parts[1] ?? "stdout";
        state.outputFile = target === "stdout" ? null : target;
        if (state.outputFile) {
          const abs = resolveVfsPath(context.cwd, state.outputFile);
          await publishSqliteOutput(context, abs, (async function* () {})());
        }
        return;
      }

      if (cmd === ".once") {
        state.onceFile = parts[1] ?? null;
        return;
      }

      if (cmd === ".tables") {
        const pattern = parts[1];
        let names: string[];
        if (db.tables && db.views) {
          names = [...db.tables.keys(), ...db.views.keys()]
            .filter((n) => !n.toLowerCase().startsWith("sqlite_"))
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        } else {
          const res = await execSingleStmt("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name;");
          names = (res?.rows ?? []).map((r) => String(r[0] ?? ""));
        }
        const filtered = pattern
          ? names.filter((n) => matchLike(n, pattern, true))
          : names;
        if (filtered.length > 0) {
          const maxLen = Math.max(...filtered.map((s) => s.length));
          const nCol = Math.max(1, Math.floor(79 / (maxLen + 2)));
          const nRow = Math.ceil(filtered.length / nCol);
          const rows: string[] = [];
          for (let r = 0; r < nRow; r += 1) {
            const cells: string[] = [];
            for (let c = 0; c < nCol; c += 1) {
              const idx = c * nRow + r;
              if (idx < filtered.length) {
                cells.push(filtered[idx]!.padEnd(maxLen, " "));
              }
            }
            rows.push(cells.join("  "));
          }
          await emitOutput(`${rows.join("\n")}\n`);
        }
        return;
      }

      if (cmd === ".schema" || cmd === ".fullschema") {
        const pattern = parts[1] && !parts[1].startsWith("-") ? parts[1] : undefined;
        const lines: string[] = [];
        if (db.tables && db.indexes && db.views && db.triggers) {
          for (const tbl of db.tables.values()) {
          if (!pattern || matchGlob(tbl.name.toLowerCase(), pattern.toLowerCase()) || tbl.name.toLowerCase() === pattern.toLowerCase()) {
            lines.push(`${tbl.sql.replace(/;*\s*$/, "")};`);
          }
        }
        for (const idx of db.indexes?.values() ?? []) {
          if (!pattern || matchGlob(idx.tableName.toLowerCase(), pattern.toLowerCase()) || idx.name.toLowerCase() === pattern.toLowerCase()) {
            lines.push(`${idx.sql.replace(/;*\s*$/, "")};`);
          }
        }
        for (const v of db.views?.values() ?? []) {
          if (!pattern || matchGlob(v.name.toLowerCase(), pattern.toLowerCase()) || v.name.toLowerCase() === pattern.toLowerCase()) {
            lines.push(`${v.sql.replace(/;*\s*$/, "")};`);
          }
        }
          for (const tr of db.triggers?.values() ?? []) {
            if (!pattern || matchGlob(tr.tableName.toLowerCase(), pattern.toLowerCase())) {
              lines.push(`${tr.sql.replace(/;*\s*$/, "")};`);
            }
          }
        } else {
          const res = await execSingleStmt("SELECT sql, name, tbl_name FROM sqlite_master WHERE sql IS NOT NULL;");
          for (const r of res?.rows ?? []) {
            const sqlStr = String(r[0] ?? "");
            const nameStr = String(r[1] ?? "");
            const tblStr = String(r[2] ?? "");
            if (!pattern || matchGlob(nameStr.toLowerCase(), pattern.toLowerCase()) || matchGlob(tblStr.toLowerCase(), pattern.toLowerCase())) {
              lines.push(`${sqlStr.replace(/;*\s*$/, "")};`);
            }
          }
        }
        if (lines.length > 0) {
          await emitOutput(`${lines.join("\n")}\n`);
        }
        return;
      }

      if (cmd === ".indexes" || cmd === ".indices") {
        const pattern = parts[1];
        let idxList: { name: string; tableName: string }[];
        if (db.indexes) {
          idxList = [...db.indexes.values()];
        } else {
          const res = await execSingleStmt(
            "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
          );
          idxList = (res?.rows ?? []).map((r) => ({ name: String(r[0] ?? ""), tableName: String(r[1] ?? "") }));
        }
        const names = idxList
          .filter(
            (idx) =>
              !pattern ||
              idx.tableName.toLowerCase() === pattern.toLowerCase() ||
              matchGlob(idx.name.toLowerCase(), pattern.toLowerCase())
          )
          .map((idx) => idx.name)
          .sort();
        if (names.length > 0) {
          await emitOutput(`${names.join("  ")}\n`);
        }
        return;
      }

      if (cmd === ".databases") {
        await emitOutput(`main: ${state.dbPath === ":memory:" ? '"" r/w' : `${state.dbPath} ${state.readonly ? "r/o" : "r/w"}`}\n`);
        return;
      }

      if (cmd === ".dump") {
        const pattern = parts[1];
        async function* dump(): AsyncGenerator<string> {
          yield "PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n";
          if (db.tables) {
            for (const tbl of db.tables.values()) {
              if (pattern && !matchGlob(tbl.name.toLowerCase(), pattern.toLowerCase()) && tbl.name.toLowerCase() !== pattern.toLowerCase()) {
                continue;
              }
              yield `${tbl.sql.replace(/;*\s*$/, "")};` + "\n";
              for (const r of tbl.rows) {
                yield `INSERT INTO ${tbl.name} VALUES(`;
                for (let column = 0; column < tbl.columns.length; column++) {
                  if (column) yield ",";
                  yield* sqlQuoteParts(r.data[tbl.columns[column]!.name] ?? null);
                }
                yield ");\n";
              }
            }
            for (const idx of db.indexes?.values() ?? []) {
              if (!pattern || idx.tableName.toLowerCase() === pattern.toLowerCase()) {
                yield `${idx.sql.replace(/;*\s*$/, "")};` + "\n";
              }
            }
            for (const v of db.views?.values() ?? []) {
              if (!pattern || v.name.toLowerCase() === pattern.toLowerCase()) {
                yield `${v.sql.replace(/;*\s*$/, "")};` + "\n";
              }
            }
            for (const tr of db.triggers?.values() ?? []) {
              if (!pattern || tr.tableName.toLowerCase() === pattern.toLowerCase()) {
                yield `${tr.sql.replace(/;*\s*$/, "")};` + "\n";
              }
            }
          } else {
            const masterRes = await execSingleStmt(
              "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%';"
            );
            for (const row of masterRes?.rows ?? []) {
              const type = String(row[0] ?? "");
              const name = String(row[1] ?? "");
              const tblName = String(row[2] ?? "");
              const sql = String(row[3] ?? "");
              if (type === "table") {
                if (pattern && !matchGlob(name.toLowerCase(), pattern.toLowerCase()) && name.toLowerCase() !== pattern.toLowerCase()) {
                  continue;
                }
                yield `${sql.replace(/;*\s*$/, "")};` + "\n";
                const rowsRes = await execSingleStmt(`SELECT * FROM "${name.replace(/"/g, '""')}";`);
                for (const r of rowsRes?.rows ?? []) {
                  yield `INSERT INTO ${name} VALUES(`;
                  for (let column = 0; column < r.length; column++) {
                    if (column) yield ",";
                    yield* sqlQuoteParts(r[column] ?? null);
                  }
                  yield ");\n";
                }
              } else if (!pattern || tblName.toLowerCase() === pattern.toLowerCase() || name.toLowerCase() === pattern.toLowerCase()) {
                yield `${sql.replace(/;*\s*$/, "")};` + "\n";
              }
            }
          }
          yield "COMMIT;\n";
        }
        await emitOutput(dump());
        return;
      }

      if (cmd === ".import") {
        if (state.readonly) throw new Error("attempt to write a readonly database");
        let pIdx = 1;
        let csvOverride = false;
        let skipRows = 0;
        while (pIdx < parts.length && parts[pIdx]!.startsWith("-")) {
          const flag = parts[pIdx]!;
          if (flag === "--csv") {
            csvOverride = true;
            pIdx += 1;
          } else if (flag === "--skip") {
            skipRows = Number(parts[pIdx + 1]) || 0;
            pIdx += 2;
          } else {
            pIdx += 1;
          }
        }
        const fileArg = parts[pIdx] ?? "";
        const tableArg = parts[pIdx + 1] ?? "";
        const filePath = resolveVfsPath(context.cwd, fileArg);
        enforceLimit("maxInputBytes", inputBytes + (await context.fs.stat(filePath)).size);
        const input = await retainInput(readFileStream(context.fs, filePath, { signal: context.signal, chunkSize: 16384 }), context, accountScript);
        let failed = false;
        try {
          const sep = csvOverride ? "," : state.colSeparator;
          const rows = async function* (): AsyncGenerator<string[]> {
            const parser = new CsvRows(sep);
            for await (const text of input.text()) yield* parser.push(text);
            yield* parser.push("", true);
          };
          skipRows = Math.trunc(skipRows);
          if (skipRows < 0) {
            let count = 0;
            for await (const row of rows()) { void row; context.signal.throwIfAborted(); count++; }
            skipRows = Math.max(0, count + skipRows);
          }
          const selected = async function* (): AsyncGenerator<string[]> {
            let index = 0;
            for await (const row of rows()) {
              context.signal.throwIfAborted();
              if (index++ >= skipRows) yield row;
            }
          };
          const records = selected();
          const first = await records.next().finally(() => records.return(undefined));
          if (first.done) return;
          let tbl = db.findTable ? db.findTable(tableArg) : undefined;
          let colCount = tbl ? tbl.columns.length : first.value.length;
          let tableExists = Boolean(tbl);
          if (!tableExists && !db.findTable) {
            const checkRes = await execSingleStmt(
              `SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower('${tableArg.replace(/'/g, "''")}');`
            );
            if ((checkRes?.rows.length ?? 0) > 0) {
              tableExists = true;
              const colRes = await execSingleStmt(`SELECT * FROM "${tableArg.replace(/"/g, '""')}" LIMIT 0;`);
              if (colRes && colRes.columns.length > 0) {
                colCount = colRes.columns.length;
              }
            }
          }
          if (!tableExists) {
            const headerCols = first.value;
            colCount = headerCols.length;
            const createSql = `CREATE TABLE "${tableArg}"(${headerCols.map((c) => `"${c}" TEXT`).join(", ")})`;
            await execSingleStmt(createSql);
            tbl = db.findTable ? db.findTable(tableArg) : undefined;
          }
          const targetTableName = tbl ? tbl.name : tableArg;
          const dataRows = async function* (): AsyncGenerator<string[]> {
            let header = !tableExists;
            for await (const row of selected()) {
              if (header) { header = false; continue; }
              yield row;
            }
          };
          if (db instanceof SqliteDatabase && await db.bulkImportRowsAsync(targetTableName, dataRows(), context.signal)) {
            state.dirty = true;
          } else {
            const batchValues: string[] = [];
            for await (const r of dataRows()) {
              if (r.length === 1 && r[0] === "" && colCount > 1) continue;
              const valsSql = Array.from({ length: colCount }, (_, cIdx) => `'${(r[cIdx] ?? "").replaceAll("'", "''")}'`).join(", ");
              batchValues.push(`(${valsSql})`);
              if (batchValues.length === 500) {
                await execSingleStmt(`INSERT INTO "${targetTableName}" VALUES ${batchValues.join(", ")}`);
                batchValues.length = 0;
              }
            }
            if (batchValues.length) await execSingleStmt(`INSERT INTO "${targetTableName}" VALUES ${batchValues.join(", ")}`);
          }
          state.dirty = true;
          return;
        } catch (error) { failed = true; throw error; }
        finally { await input.close().catch(error => { if (!failed) throw error; }); }
      }

      if (cmd === ".read") {
        const filePath = resolveVfsPath(context.cwd, parts[1] ?? "");
        await processScript(scriptFileLines(filePath));
        return;
      }

      if (cmd === ".open") {
        let pIdx = 1;
        let resetNew = false;
        while (pIdx < parts.length && parts[pIdx]!.startsWith("-")) {
          if (parts[pIdx] === "--new") {
            resetNew = true;
          } else if (parts[pIdx] === "--readonly") {
            state.readonly = true;
          }
          pIdx += 1;
        }
        if (state.dirty && state.dbPath !== ":memory:") {
          await saveDbToDisk(state.dbPath);
        }
        const newPath = parts[pIdx] ? resolveVfsPath(context.cwd, parts[pIdx]!) : ":memory:";
        state.dbPath = newPath;
        db.tables?.clear();
        db.indexes?.clear();
        db.views?.clear();
        db.triggers?.clear();
        if (!resetNew && newPath !== ":memory:") {
          await loadDbFromDisk(newPath);
        }
        return;
      }

      if (cmd === ".save" || cmd === ".backup") {
        const targetArg = parts.length >= 3 ? parts[2]! : parts[1]!;
        const targetPath = resolveVfsPath(context.cwd, targetArg);
        await saveDbToDisk(targetPath);
        return;
      }

      if (cmd === ".restore") {
        if (state.readonly) throw new Error("attempt to write a readonly database");
        const srcArg = parts.length >= 3 ? parts[2]! : parts[1]!;
        const srcPath = resolveVfsPath(context.cwd, srcArg);
        db.tables?.clear();
        db.indexes?.clear();
        db.views?.clear();
        db.triggers?.clear();
        await loadDbFromDisk(srcPath);
        state.dirty = true;
        return;
      }

      if (cmd === ".parameter" || cmd === ".param") {
        const sub = (parts[1] ?? "").toLowerCase();
        if (sub === "set") {
          const key = parts[2] ?? "";
          const valRaw = parts[3] ?? "";
          let val: SqlValue = valRaw;
          if (/^-?\d+(\.\d+)?$/.test(valRaw)) {
            val = Number(valRaw);
          } else if (valRaw.startsWith("'") && valRaw.endsWith("'")) {
            val = valRaw.slice(1, -1);
          }
          db.parameters?.set(key, val);
        } else if (sub === "unset") {
          db.parameters?.delete(parts[2] ?? "");
        } else if (sub === "clear" || sub === "init") {
          db.parameters?.clear();
        } else if (sub === "list") {
          for (const [k, v] of (db.parameters?.entries() ?? [])) {
            await emitOutput(`${k} ${formatSqlQuote(v)}\n`);
          }
        }
        return;
      }

      if (cmd === ".help") {
        await emitOutput(
          ".backup ?DB? FILE        Backup DB to FILE\n.bail on|off             Stop after hitting an error\n.databases               List names and files of attached databases\n.dump ?OBJECTS?          Render database content as SQL\n.exit ?CODE?             Exit this program\n.headers on|off          Turn display of headers on or off\n.import FILE TABLE       Import data from FILE into TABLE\n.indexes ?TABLE?         Show names of indexes\n.mode MODE               Set output mode\n.nullvalue STRING        Use STRING in place of NULL values\n.open ?OPTIONS? ?FILE?   Close existing database and reopen FILE\n.output ?FILE?           Send output to FILE or stdout\n.print STRING...         Print literal STRING\n.quit                    Exit this program\n.read FILE               Read input from FILE\n.schema ?PATTERN?        Show the CREATE statements matching PATTERN\n.separator COL ?ROW?     Change the column and row separators\n.show                    Show the current values for various settings\n.tables ?TABLE?          List names of tables\n"
        );
        return;
      }
      throw new Error(`unknown command or invalid arguments:  "${cmd.slice(1)}". Enter ".help" for help`);
    };

    const runSqlStatement = async (stmt: string): Promise<void> => {
      if (state.echo) {
        await emitOutput(`${stmt}\n`);
      }
      const isMutating = isMutatingStatement(stmt);

      if (state.readonly && isMutating) {
        throw new Error("attempt to write a readonly database");
      }

      const res = await execSingleStmt(stmt);
      if (isMutating) {
        state.dirty = true;
      }
      if (res) {
        const formatted = formatQueryParts(res, state);
        await emitOutput(formatted);
      }
      if (state.changes && isMutating) {
        await emitOutput(`changes: ${db.lastChanges ?? 0}   total_changes: ${db.totalChanges ?? 0}\n`);
      }
    };

    const accountScript = (size: number) => {
      inputBytes += size;
      enforceLimit("maxInputBytes", inputBytes);
    };
    async function* scriptFileLines(path: string): AsyncGenerator<string> {
      enforceLimit("maxInputBytes", inputBytes + (await context.fs.stat(path)).size);
      yield* stagedScriptLines(readFileStream(context.fs, path, { signal: context.signal, chunkSize: 16384 }), context, accountScript);
    }
    const processScript = async (script: string | AsyncIterable<string>): Promise<boolean> => {
      if (typeof script === "string") {
        inputBytes += textEncoder.encode(script).byteLength;
        enforceLimit("maxInputBytes", inputBytes);
      }
      // Process script mixing dot-commands (lines starting with '.') and SQL statements
      const lines = typeof script === "string" ? script.split(/\r?\n/) : script;
      let sqlBuffer: string[] = [];

      const flushSqlBuffer = async (): Promise<boolean> => {
        const joined = sqlBuffer.join("\n").trim();
        sqlBuffer = [];
        if (!joined) {
          return true;
        }
        const stmts = splitSqlStatements(joined);
        for (const st of stmts) {
          try {
            await runSqlStatement(st);
          } catch (err) {
            context.signal.throwIfAborted();
            const msg = err instanceof Error ? err.message : String(err);
            await writeText(context.stderr, `Error: ${msg}\n`);
            if (state.bail || positional.length >= 2) {
              state.exitCode = 1;
              return false;
            }
            state.exitCode = 1;
          }
          if (state.exitRequested) {
            return false;
          }
        }
        return true;
      };

      for await (const line of lines) {
        const trimmed = line.trim();
        if (sqlBuffer.length === 0 && trimmed.startsWith(".") && !/^\.\d/.test(trimmed)) {
          try {
            await executeDotCommand(trimmed);
          } catch (err) {
            context.signal.throwIfAborted();
            const msg = err instanceof Error ? err.message : String(err);
            await writeText(context.stderr, `Error: ${msg}\n`);
            state.exitCode = 1;
            if (state.bail) {
              return false;
            }
          }
          if (state.exitRequested) {
            return false;
          }
        } else {
          sqlBuffer.push(line);
          if (trimmed.endsWith(";") && !(/\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b[\s\S]*\bBEGIN\b/i.test(sqlBuffer.join("\n")) && !/\bEND\s*;\s*$/i.test(sqlBuffer.join("\n")))) {
            const ok = await flushSqlBuffer();
            if (!ok) {
              return false;
            }
          }
        }
      }

      return flushSqlBuffer();
    };

    if (initFile) {
      try {
        await processScript(scriptFileLines(resolveVfsPath(context.cwd, initFile)));
      } catch (err) {
        context.signal.throwIfAborted();
        await writeText(context.stderr, `Error: cannot read init file "${initFile}": ${err instanceof Error ? err.message : String(err)}\n`);
        return { exitCode: 1 };
      }
    }

    for (const cmdStr of preCommands) {
      if (state.exitRequested) break;
      const ok = await processScript(cmdStr);
      if (!ok || state.exitRequested) {
        break;
      }
    }

    if (!state.exitRequested) {
      if (positional.length >= 2) {
        for (let p = 1; p < positional.length; p += 1) {
          const ok = await processScript(positional[p]!);
          if (!ok || state.exitRequested) {
            break;
          }
        }
      } else {
        await processScript(stagedScriptLines(context.stdin, context, accountScript));
      }
    }

    if (!limitExceeded && state.dirty && state.dbPath !== ":memory:" && !state.readonly) {
      await saveDbToDisk(state.dbPath);
    }

    return { exitCode: limitExceeded ? 1 : state.exitCode };
    } catch (error) {
      context.signal.throwIfAborted();
      await writeText(context.stderr, `Error: ${error instanceof Error ? error.message : String(error)}\n`);
      return { exitCode: 1 };
    }
    }
  };
}

export function createSqlite3Commands(options: Sqlite3CommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createSqlite3Command(options)]);
}

export function sqlite3Commands(options: Sqlite3CommandsOptions = {}): VirtualShellPlugin {
  const commands = createSqlite3Commands(options);
  return {
    name: "sqlite3-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    }
  };
}

const fatalSyncSqliteDecoder = new TextDecoder("utf-8", { fatal: true });
export function evalSyncSqlite3(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const state: CliSessionState = {
      mode: "list",
      insertTable: "table",
      showHeaders: false,
      colSeparator: "|",
      rowSeparator: "\n",
      nullValue: "",
      bail: false,
      echo: false,
      changes: false,
      readonly: false,
      widths: [],
      outputFile: null,
      onceFile: null,
      dbPath: ":memory:",
      dirty: false,
      exitRequested: false,
      exitCode: 0,
    };

    const preCommands: string[] = [];
    let initFile: string | null = null;
    const positional: string[] = [];

    let i = 0;
    while (i < opArgs.length) {
      const arg = opArgs[i]!;
      if (arg === "--") {
        positional.push(...opArgs.slice(i + 1));
        break;
      }
      if (arg === "-version" || arg === "--version") {
        return "3.45.0 2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d\n";
      }
      if (arg === "-help" || arg === "--help") {
        return "Usage: sqlite3 [OPTIONS] FILENAME [SQL]\nOptions:\n  -bail                stop after hitting an error\n  -batch               force batch I/O\n  -box                 set output mode to 'box'\n  -column              set output mode to 'column'\n  -cmd COMMAND         run \"COMMAND\" before reading stdin\n  -csv                 set output mode to 'csv'\n  -echo                print inputs before execution\n  -header              turn headers on\n  -noheader            turn headers off\n  -html                set output mode to HTML\n  -init FILENAME       read/process named file\n  -json                set output mode to 'json'\n  -line                set output mode to 'line'\n  -list                set output mode to 'list'\n  -markdown            set output mode to 'markdown'\n  -nullvalue TEXT      set text string for NULL values\n  -quote               set output mode to 'quote'\n  -readonly            open the database read-only\n  -separator SEP       set output column separator\n  -table               set output mode to 'table'\n  -tabs                set output mode to 'tabs'\n  -version             show SQLite version\n";
      }
      if (arg === "-csv" || arg === "--csv") {
        state.mode = "csv";
        state.colSeparator = ",";
      } else if (arg === "-json" || arg === "--json") {
        state.mode = "json";
      } else if (arg === "-line" || arg === "--line") {
        state.mode = "line";
      } else if (arg === "-list" || arg === "--list") {
        state.mode = "list";
        state.colSeparator = "|";
      } else if (arg === "-column" || arg === "--column") {
        state.mode = "column";
      } else if (arg === "-table" || arg === "--table") {
        state.mode = "table";
        state.showHeaders = true;
      } else if (arg === "-box" || arg === "--box") {
        state.mode = "box";
        state.showHeaders = true;
      } else if (arg === "-markdown" || arg === "--markdown") {
        state.mode = "markdown";
        state.showHeaders = true;
      } else if (arg === "-quote" || arg === "--quote") {
        state.mode = "quote";
      } else if (arg === "-tabs" || arg === "--tabs") {
        state.mode = "tabs";
        state.colSeparator = "\t";
      } else if (arg === "-html" || arg === "--html") {
        state.mode = "html";
      } else if (arg === "-ascii" || arg === "--ascii") {
        state.mode = "ascii";
        state.colSeparator = "\x1f";
        state.rowSeparator = "\x1e";
      } else if (arg === "-header" || arg === "--header") {
        state.showHeaders = true;
      } else if (arg === "-noheader" || arg === "--noheader") {
        state.showHeaders = false;
      } else if (arg === "-bail" || arg === "--bail") {
        state.bail = true;
      } else if (arg === "-echo" || arg === "--echo") {
        state.echo = true;
      } else if (arg === "-readonly" || arg === "--readonly") {
        state.readonly = true;
      } else if (arg === "-batch" || arg === "--batch" || arg === "-interactive" || arg === "--interactive") {
        // Accepted flags
      } else if (arg === "-separator" || arg === "--separator") {
        state.colSeparator = opArgs[i + 1] ?? "|";
        i += 1;
      } else if (arg === "-nullvalue" || arg === "--nullvalue") {
        state.nullValue = opArgs[i + 1] ?? "";
        i += 1;
      } else if (arg === "-cmd" || arg === "--cmd") {
        if (opArgs[i + 1] !== undefined) {
          preCommands.push(opArgs[i + 1]!);
        }
        i += 1;
      } else if (arg === "-init" || arg === "--init") {
        initFile = opArgs[i + 1] ?? null;
        i += 1;
      } else if (arg.startsWith("-") && positional.length === 0) {
        return undefined;
      } else {
        positional.push(arg);
      }
      i += 1;
    }

    if (positional.length > 0 && positional[0] !== "") {
      state.dbPath = positional[0]!;
    }

    const db = new SqliteDatabase();
    if (state.dbPath !== ":memory:") {
      if (!readFileSync) return undefined;
      const dbBytes = readFileSync(state.dbPath);
      if (dbBytes === undefined) {
        if (state.readonly) return undefined;
      } else {
        if (dbBytes.byteLength > 262144) return undefined;
        if (dbBytes.byteLength > 0) {
          db.loadFromBytes(dbBytes);
        }
      }
    }

    let out = "";
    const pendingSaves: Array<{ file: string; bytes: Uint8Array }> = [];
    const emitOutput = (text: string) => {
      if (state.onceFile || (state.outputFile && state.outputFile !== "stdout")) {
        throw new Error("file output unsupported in sync sqlite3");
      }
      out += text;
    };

    const executeDotCommandSync = (line: string): boolean => {
      const parts = splitDotCommandArgs(line);
      const cmd = (parts[0] ?? "").toLowerCase();
      if (cmd === ".quit" || cmd === ".exit" || cmd === ".q") {
        state.exitRequested = true;
        if (parts[1] !== undefined) {
          state.exitCode = Number(parts[1]) || 0;
        }
        return state.exitCode === 0;
      }
      if (cmd === ".mode") {
        setOutputMode(state, (parts[1] ?? "list").toLowerCase(), parts[2]);
        return true;
      }
      if (cmd === ".headers" || cmd === ".header") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.showHeaders = val === "on" || val === "1" || val === "true" || val === "yes";
        return true;
      }
      if (cmd === ".separator") {
        if (parts[1] !== undefined) state.colSeparator = parts[1];
        if (parts[2] !== undefined) state.rowSeparator = parts[2];
        return true;
      }
      if (cmd === ".nullvalue") {
        state.nullValue = parts[1] ?? "";
        return true;
      }
      if (cmd === ".width") {
        state.widths = parts.slice(1).map((x) => Number(x) || 0);
        return true;
      }
      if (cmd === ".print") {
        emitOutput(`${parts.slice(1).join(" ")}\n`);
        return true;
      }
      if (cmd === ".echo") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.echo = val === "on" || val === "1" || val === "true";
        return true;
      }
      if (cmd === ".bail") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.bail = val === "on" || val === "1" || val === "true";
        return true;
      }
      if (cmd === ".changes") {
        const val = (parts[1] ?? "on").toLowerCase();
        state.changes = val === "on" || val === "1" || val === "true";
        return true;
      }
      if (cmd === ".show") {
        const info = [
          `        echo: ${state.echo ? "on" : "off"}`,
          `     headers: ${state.showHeaders ? "on" : "off"}`,
          `        mode: ${state.mode}`,
          `   nullvalue: "${state.nullValue}"`,
          `      output: ${state.outputFile ?? "stdout"}`,
          `colseparator: "${state.colSeparator}"`,
          `rowseparator: "${state.rowSeparator === "\n" ? "\\n" : state.rowSeparator}"`
        ].join("\n");
        emitOutput(`${info}\n`);
        return true;
      }
      if (cmd === ".tables") {
        const pattern = parts[1];
        const names = [...db.tables.keys(), ...db.views.keys()]
          .filter((n) => !n.toLowerCase().startsWith("sqlite_"))
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const filtered = pattern
          ? names.filter((n) => matchLike(n, pattern, true))
          : names;
        if (filtered.length > 0) {
          const maxLen = Math.max(...filtered.map((s) => s.length));
          const nCol = Math.max(1, Math.floor(79 / (maxLen + 2)));
          const nRow = Math.ceil(filtered.length / nCol);
          const rows: string[] = [];
          for (let r = 0; r < nRow; r += 1) {
            const cells: string[] = [];
            for (let c = 0; c < nCol; c += 1) {
              const idx = c * nRow + r;
              if (idx < filtered.length) cells.push(filtered[idx]!.padEnd(maxLen, " "));
            }
            rows.push(cells.join("  "));
          }
          emitOutput(`${rows.join("\n")}\n`);
        }
        return true;
      }
      if (cmd === ".schema" || cmd === ".fullschema") {
        const pattern = parts[1] && !parts[1].startsWith("-") ? parts[1] : undefined;
        const lines: string[] = [];
        for (const tbl of db.tables.values()) {
          if (!pattern || matchGlob(tbl.name.toLowerCase(), pattern.toLowerCase()) || tbl.name.toLowerCase() === pattern.toLowerCase()) {
            lines.push(`${tbl.sql.replace(/;*\s*$/, "")};`);
          }
        }
        for (const idx of db.indexes.values()) {
          if (!pattern || matchGlob(idx.tableName.toLowerCase(), pattern.toLowerCase()) || idx.name.toLowerCase() === pattern.toLowerCase()) {
            lines.push(`${idx.sql.replace(/;*\s*$/, "")};`);
          }
        }
        for (const v of db.views.values()) {
          if (!pattern || matchGlob(v.name.toLowerCase(), pattern.toLowerCase()) || v.name.toLowerCase() === pattern.toLowerCase()) {
            lines.push(`${v.sql.replace(/;*\s*$/, "")};`);
          }
        }
        for (const tr of db.triggers.values()) {
          if (!pattern || matchGlob(tr.tableName.toLowerCase(), pattern.toLowerCase())) {
            lines.push(`${tr.sql.replace(/;*\s*$/, "")};`);
          }
        }
        if (lines.length > 0) emitOutput(`${lines.join("\n")}\n`);
        return true;
      }
      if (cmd === ".indexes" || cmd === ".indices") {
        const pattern = parts[1];
        const names = [...db.indexes.values()]
          .filter((idx) => !pattern || idx.tableName.toLowerCase() === pattern.toLowerCase() || matchGlob(idx.name.toLowerCase(), pattern.toLowerCase()))
          .map((idx) => idx.name)
          .sort();
        if (names.length > 0) emitOutput(`${names.join("  ")}\n`);
        return true;
      }
      if (cmd === ".databases") {
        emitOutput(`main: ${state.dbPath === ":memory:" ? "\"\" r/w" : `${state.dbPath} ${state.readonly ? "r/o" : "r/w"}`}\n`);
        return true;
      }
      if (cmd === ".dump") {
        const pattern = parts[1];
        const dumpLines: string[] = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
        for (const tbl of db.tables.values()) {
          if (pattern && !matchGlob(tbl.name.toLowerCase(), pattern.toLowerCase()) && tbl.name.toLowerCase() !== pattern.toLowerCase()) continue;
          dumpLines.push(`${tbl.sql.replace(/;*\s*$/, "")};`);
          for (const r of tbl.rows) {
            const vals = tbl.columns.map((c) => formatSqlQuote(r.data[c.name] ?? null)).join(",");
            dumpLines.push(`INSERT INTO ${tbl.name} VALUES(${vals});`);
          }
        }
        for (const idx of db.indexes.values()) {
          if (!pattern || idx.tableName.toLowerCase() === pattern.toLowerCase()) dumpLines.push(`${idx.sql.replace(/;*\s*$/, "")};`);
        }
        for (const v of db.views.values()) {
          if (!pattern || v.name.toLowerCase() === pattern.toLowerCase()) dumpLines.push(`${v.sql.replace(/;*\s*$/, "")};`);
        }
        for (const tr of db.triggers.values()) {
          if (!pattern || tr.tableName.toLowerCase() === pattern.toLowerCase()) dumpLines.push(`${tr.sql.replace(/;*\s*$/, "")};`);
        }
        dumpLines.push("COMMIT;");
        emitOutput(`${dumpLines.join("\n")}\n`);
        return true;
      }
      if (cmd === ".save" || cmd === ".backup") {
        const targetFile = parts[parts.length - 1];
        if (!targetFile || targetFile === "-" || !writeFileSync) return false;
        pendingSaves.push({ file: targetFile, bytes: db.serializeToBytes() });
        return true;
      }
      if (cmd === ".parameter" || cmd === ".param") {
        const sub = (parts[1] ?? "").toLowerCase();
        if (sub === "set") {
          const key = parts[2] ?? "";
          const valRaw = parts[3] ?? "";
          let val: SqlValue = valRaw;
          if (/^-?\d+(\.\d+)?$/.test(valRaw)) {
            val = Number(valRaw);
          } else if (valRaw.startsWith("'") && valRaw.endsWith("'")) {
            val = valRaw.slice(1, -1);
          }
          db.parameters?.set(key, val);
        } else if (sub === "unset") {
          db.parameters?.delete(parts[2] ?? "");
        } else if (sub === "clear" || sub === "init") {
          db.parameters?.clear();
        } else if (sub === "list") {
          for (const [k, v] of (db.parameters?.entries() ?? [])) {
            emitOutput(`${k} ${formatSqlQuote(v)}\n`);
          }
        }
        return true;
      }
      if (cmd === ".read") {
        const srcFile = parts[1];
        if (!srcFile || !readFileSync) return false;
        const srcBytes = readFileSync(srcFile);
        if (!srcBytes) return false;
        if (srcBytes.includes(0)) return false;
        return processScriptSync(fatalSyncSqliteDecoder.decode(srcBytes));
      }
      if (cmd === ".import") {
        if ((state.dbPath !== ":memory:" && !writeFileSync) || state.readonly || !readFileSync) return false;
        let pIdx = 1;
        let csvOverride = false;
        let skipRows = 0;
        while (pIdx < parts.length && parts[pIdx]!.startsWith("-")) {
          const flag = parts[pIdx]!;
          if (flag === "--csv") {
            csvOverride = true;
            pIdx += 1;
          } else if (flag === "--skip") {
            skipRows = Number(parts[pIdx + 1]) || 0;
            pIdx += 2;
          } else {
            pIdx += 1;
          }
        }
        const fileArg = parts[pIdx] ?? "";
        const tableArg = parts[pIdx + 1] ?? "";
        const fileBytes = readFileSync(fileArg);
        if (!fileBytes || fileBytes.byteLength > 16 * 1024 * 1024) return false;
        if (fileBytes.includes(0)) return false;
        const content = fatalSyncSqliteDecoder.decode(fileBytes);
        const sep = csvOverride ? "," : state.colSeparator;
        const parsedRows = parseCsvContent(content, sep).slice(skipRows);
        if (parsedRows.length === 0) return true;
        let tbl = db.findTable(tableArg);
        let dataRows = parsedRows;
        let colCount = tbl ? tbl.columns.length : (parsedRows[0]?.length ?? 0);
        if (!tbl) {
          const headerCols = parsedRows[0]!;
          colCount = headerCols.length;
          dataRows = parsedRows.slice(1);
          const createSql = `CREATE TABLE "${tableArg}"(${headerCols.map((c) => `"${c}" TEXT`).join(", ")})`;
          db.executeStatement(createSql);
          tbl = db.findTable(tableArg);
        }
        const batchValues: string[] = [];
        for (const r of dataRows) {
          if (r.length === 1 && r[0] === "" && colCount > 1) continue;
          const valsSql = Array.from({ length: colCount }, (_, cIdx) => `'${(r[cIdx] ?? "").replace(/'/g, "''")}'`).join(", ");
          batchValues.push(`(${valsSql})`);
        }
        for (let b = 0; b < batchValues.length; b += 500) {
          const chunk = batchValues.slice(b, b + 500);
          db.executeStatement(`INSERT INTO "${tbl ? tbl.name : tableArg}" VALUES ${chunk.join(", ")}`);
        }
        state.dirty = true;
        return true;
      }
      return false;
    };

    const runSqlStatementSync = (stmt: string): boolean => {
      const trimmed = stmt.trim();
      if (!trimmed) return true;
      const isMutating = isMutatingStatement(trimmed);
      if (isMutating) {
        if (state.readonly || (state.dbPath !== ":memory:" && !writeFileSync)) return false;
      }
      if (state.echo) emitOutput(`${trimmed}\n`);
      const res = db.executeStatement(trimmed);
      if (isMutating) state.dirty = true;
      if (res) {
        emitOutput([...formatQueryParts(res, state)].join(""));
      }
      if (state.changes && isMutating) {
        emitOutput(`changes: ${db.lastChanges ?? 0}   total_changes: ${db.totalChanges ?? 0}\n`);
      }
      return true;
    };

    const processScriptSync = (script: string): boolean => {
      const lines = script.split(/\r?\n/);
      let sqlBuffer: string[] = [];
      const flushSqlBuffer = (): boolean => {
        const joined = sqlBuffer.join("\n").trim();
        sqlBuffer = [];
        if (!joined) return true;
        const stmts = splitSqlStatements(joined);
        for (const st of stmts) {
          if (!runSqlStatementSync(st)) return false;
          if (state.exitRequested) return true;
        }
        return true;
      };
      for (const line of lines) {
        const trimmed = line.trim();
        if (sqlBuffer.length === 0 && trimmed.startsWith(".") && !/^\.\d/.test(trimmed)) {
          if (!executeDotCommandSync(trimmed)) return false;
          if (state.exitRequested) return true;
        } else {
          sqlBuffer.push(line);
          if (trimmed.endsWith(";") && !(/\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b[\s\S]*\bBEGIN\b/i.test(sqlBuffer.join("\n")) && !/\bEND\s*;\s*$/i.test(sqlBuffer.join("\n")))) {
            if (!flushSqlBuffer()) return false;
            if (state.exitRequested) return true;
          }
        }
      }
      return flushSqlBuffer();
    };

    if (initFile) {
      if (!readFileSync) return undefined;
      const initBytes = readFileSync(initFile);
      if (!initBytes) return undefined;
      if (initBytes.includes(0) || !processScriptSync(fatalSyncSqliteDecoder.decode(initBytes))) return undefined;
    }

    for (const cmdStr of preCommands) {
      if (state.exitRequested) break;
      if (!processScriptSync(cmdStr)) return undefined;
    }

    if (!state.exitRequested) {
      if (positional.length >= 2) {
        for (let p = 1; p < positional.length; p += 1) {
          if (!processScriptSync(positional[p]!)) return undefined;
          if (state.exitRequested) break;
        }
      } else if (inBytes !== undefined) {
        if (inBytes.byteLength > 0 && (inBytes.includes(0) || !processScriptSync(fatalSyncSqliteDecoder.decode(inBytes)))) return undefined;
      } else if (preCommands.length === 0 && !initFile) {
        return undefined;
      }
    }

    if (state.exitCode !== 0 || out.includes("\0")) return undefined;
    for (const save of pendingSaves) {
      if (!save.file || save.file.endsWith("/") || save.file.endsWith("/.") || save.file.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(save.file)) return undefined;
    }
    if (state.dirty && state.dbPath !== ":memory:") {
      if (!state.dbPath || state.dbPath.endsWith("/") || state.dbPath.endsWith("/.") || state.dbPath.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(state.dbPath)) return undefined;
    }
    for (const save of pendingSaves) {
      if (!writeFileSync || !writeFileSync(save.file, save.bytes)) return undefined;
    }
    if (state.dirty && state.dbPath !== ":memory:") {
      if (!writeFileSync || !writeFileSync(state.dbPath, db.serializeToBytes())) return undefined;
    }
    return out;
  } catch {
    return undefined;
  }
}
