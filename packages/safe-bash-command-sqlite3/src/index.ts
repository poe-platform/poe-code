import {
  collectBytes,
  commandRuntimeIdentity,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import {
  SqliteDatabase,
  matchGlob,
  splitSqlStatements,
  toSqlString,
  type QueryResultSet,
  type SqlValue
} from "./engine.js";

export interface Sqlite3Limits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRows: number;
}

export interface SqliteEngineInstance {
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

export type SqliteEngineFactory = (options: {
  readonly dbPath: string;
  readonly readonly: boolean;
  readonly context: CommandContext;
}) => Promise<SqliteEngineInstance> | SqliteEngineInstance;

export interface Sqlite3CommandsOptions {
  readonly replace?: boolean | undefined;
  readonly limits?: Partial<Sqlite3Limits> | undefined;
  readonly engine?: SqliteEngineFactory | SqliteEngineInstance | undefined;
}

export type Sqlite3Options = Sqlite3CommandsOptions;

type OutputMode =
  | "list"
  | "csv"
  | "column"
  | "line"
  | "json"
  | "tabs"
  | "html"
  | "markdown"
  | "box"
  | "table"
  | "quote"
  | "ascii"
  | "insert";

interface CliSessionState {
  mode: OutputMode;
  insertTable: string;
  showHeaders: boolean;
  colSeparator: string;
  rowSeparator: string;
  nullValue: string;
  bail: boolean;
  echo: boolean;
  changes: boolean;
  readonly: boolean;
  widths: number[];
  outputFile: string | null;
  onceFile: string | null;
  dbPath: string;
  dirty: boolean;
  exitRequested: boolean;
  exitCode: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

async function vfsExists(fs: CommandContext["fs"], path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function vfsReadText(fs: CommandContext["fs"], path: string): Promise<string> {
  const bytes = await fs.readFile(path);
  return textDecoder.decode(bytes);
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

function formatSqlQuote(v: SqlValue): string {
  if (v === null || v === undefined) {
    return "NULL";
  }
  if (typeof v === "bigint") {
    return v.toString();
  }
  if (v instanceof Number) {
    const n = v.valueOf();
    return Number.isFinite(n) && Number.isInteger(n) ? `${n}.0` : String(n);
  }
  if (typeof v === "number") {
    return String(v);
  }
  if (typeof v === "string") {
    return `'${v.replace(/'/g, "''")}'`;
  }
  let hex = "";
  for (const b of v) {
    hex += b.toString(16).toUpperCase().padStart(2, "0");
  }
  return `X'${hex}'`;
}

function formatCsvCell(s: string, sep: string): string {
  if (s.includes('"') || s.includes(sep) || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCellValue(v: SqlValue, nullValue: string): string {
  if (v === null || v === undefined) {
    return nullValue;
  }
  return toSqlString(v);
}

function formatQueryResult(res: QueryResultSet, state: CliSessionState): string {
  const { columns, rows } = res;
  if (columns.length === 0) {
    return "";
  }

  switch (state.mode) {
    case "list": {
      if (!state.showHeaders && rows.length === 0) {
        return "";
      }
      const lines: string[] = [];
      if (state.showHeaders) {
        lines.push(columns.join(state.colSeparator));
      }
      for (const r of rows) {
        lines.push(r.map((v) => formatCellValue(v, state.nullValue)).join(state.colSeparator));
      }
      return lines.map((l) => `${l}${state.rowSeparator}`).join("");
    }

    case "tabs": {
      if (!state.showHeaders && rows.length === 0) {
        return "";
      }
      const lines: string[] = [];
      if (state.showHeaders) {
        lines.push(columns.join("\t"));
      }
      for (const r of rows) {
        lines.push(r.map((v) => formatCellValue(v, state.nullValue)).join("\t"));
      }
      return `${lines.join("\n")}\n`;
    }

    case "ascii": {
      if (!state.showHeaders && rows.length === 0) {
        return "";
      }
      const cSep = "\x1f";
      const rSep = "\x1e";
      let out = "";
      if (state.showHeaders) {
        out += columns.join(cSep) + rSep;
      }
      for (const r of rows) {
        out += r.map((v) => formatCellValue(v, state.nullValue)).join(cSep) + rSep;
      }
      return out;
    }

    case "csv": {
      if (!state.showHeaders && rows.length === 0) {
        return "";
      }
      const sep = state.colSeparator === "|" ? "," : state.colSeparator;
      const lines: string[] = [];
      if (state.showHeaders) {
        lines.push(columns.map((c) => formatCsvCell(c, sep)).join(sep));
      }
      for (const r of rows) {
        lines.push(r.map((v) => formatCsvCell(formatCellValue(v, state.nullValue), sep)).join(sep));
      }
      return `${lines.join("\n")}\n`;
    }

    case "json": {
      const objs = rows.map((r) => {
        const o: Record<string, unknown> = {};
        columns.forEach((c, i) => {
          const val = r[i];
          o[c] = val instanceof Uint8Array ? toSqlString(val) : (val ?? null);
        });
        return o;
      });
      if (objs.length === 0) return "[]\n";
      return `[${objs.map((o) => JSON.stringify(o)).join(",\n")}]\n`;
    }

    case "line": {
      if (rows.length === 0) {
        return "";
      }
      const maxColLen = Math.max(5, ...columns.map((c) => c.length));
      const blocks = rows.map((r) =>
        columns
          .map((c, i) => `${c.padStart(maxColLen, " ")} = ${formatCellValue(r[i] ?? null, state.nullValue)}`)
          .join("\n")
      );
      return `${blocks.join("\n\n")}\n`;
    }

    case "html": {
      if (!state.showHeaders && rows.length === 0) {
        return "";
      }
      const lines: string[] = [];
      if (state.showHeaders) {
        lines.push(`<TR>${columns.map((c) => `<TH>${escapeHtml(c)}</TH>`).join("")}</TR>`);
      }
      for (const r of rows) {
        lines.push(
          `<TR>${r.map((v) => `<TD>${escapeHtml(formatCellValue(v, state.nullValue))}</TD>`).join("")}</TR>`
        );
      }
      return `${lines.join("\n")}\n`;
    }

    case "quote": {
      if (!state.showHeaders && rows.length === 0) {
        return "";
      }
      const lines: string[] = [];
      if (state.showHeaders) {
        lines.push(columns.map((c) => formatSqlQuote(c)).join(","));
      }
      for (const r of rows) {
        lines.push(r.map((v) => formatSqlQuote(v)).join(","));
      }
      return `${lines.join("\n")}\n`;
    }

    case "insert": {
      if (rows.length === 0) {
        return "";
      }
      const tbl = state.insertTable || "table";
      const lines = rows.map((r) => `INSERT INTO ${tbl} VALUES(${r.map((v) => formatSqlQuote(v)).join(",")});`);
      return `${lines.join("\n")}\n`;
    }

    case "column":
    case "table":
    case "markdown":
    case "box": {
      if (!state.showHeaders && rows.length === 0) {
        return "";
      }
      const strRows = rows.map((r) => r.map((v) => formatCellValue(v, state.nullValue)));
      const colWidths = columns.map((c, i) => {
        const explicit = state.widths[i];
        if (explicit && explicit > 0) {
          return explicit;
        }
        const maxData = strRows.reduce((m, r) => Math.max(m, (r[i] ?? "").length), 0);
        return Math.max(state.showHeaders ? c.length : 1, maxData, 1);
      });

      if (state.mode === "column") {
        const lines: string[] = [];
        if (state.showHeaders) {
          lines.push(columns.map((c, i) => c.padEnd(colWidths[i]!, " ")).join("  ").trimEnd());
          lines.push(colWidths.map((w) => "-".repeat(w)).join("  "));
        }
        for (const r of strRows) {
          lines.push(r.map((cell, i) => cell.padEnd(colWidths[i]!, " ")).join("  ").trimEnd());
        }
        return `${lines.join("\n")}\n`;
      }

      const centerHeader = (s: string, w: number): string => {
        const diff = w - s.length;
        if (diff <= 0) return s;
        const left = Math.floor(diff / 2);
        return " ".repeat(left) + s + " ".repeat(diff - left);
      };

      if (state.mode === "markdown") {
        const lines: string[] = [];
        lines.push(`| ${columns.map((c, i) => centerHeader(c, colWidths[i]!)).join(" | ")} |`);
        lines.push(`|-${colWidths.map((w) => "-".repeat(w)).join("-|-")}-|`);
        for (const r of strRows) {
          lines.push(`| ${r.map((cell, i) => cell.padEnd(colWidths[i]!, " ")).join(" | ")} |`);
        }
        return `${lines.join("\n")}\n`;
      }

      if (state.mode === "table") {
        const border = `+${colWidths.map((w) => "-".repeat(w + 2)).join("+")}+`;
        const lines: string[] = [border];
        if (state.showHeaders) {
          lines.push(`| ${columns.map((c, i) => centerHeader(c, colWidths[i]!)).join(" | ")} |`);
          lines.push(border);
        }
        for (const r of strRows) {
          lines.push(`| ${r.map((cell, i) => cell.padEnd(colWidths[i]!, " ")).join(" | ")} |`);
        }
        lines.push(border);
        return `${lines.join("\n")}\n`;
      }

      // box mode
      const top = `┌${colWidths.map((w) => "─".repeat(w + 2)).join("┬")}┐`;
      const mid = `├${colWidths.map((w) => "─".repeat(w + 2)).join("┼")}┤`;
      const bot = `└${colWidths.map((w) => "─".repeat(w + 2)).join("┴")}┘`;
      const lines: string[] = [top];
      if (state.showHeaders) {
        lines.push(`│ ${columns.map((c, i) => c.padEnd(colWidths[i]!, " ")).join(" │ ")} │`);
        lines.push(mid);
      }
      for (const r of strRows) {
        lines.push(`│ ${r.map((cell, i) => cell.padEnd(colWidths[i]!, " ")).join(" │ ")} │`);
      }
      lines.push(bot);
      return `${lines.join("\n")}\n`;
    }
  }
}

function parseCsvContent(content: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && cur.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (content.startsWith(separator, i)) {
      row.push(cur);
      cur = "";
      i += separator.length;
      continue;
    }
    if (ch === "\r" && content[i + 1] === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i += 2;
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
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

export const settings = {
  commandName: "sqlite3",
  limits: {
    maxInputBytes: 16 * 1024 * 1024,
    maxOutputBytes: 16 * 1024 * 1024,
    maxRows: 100000
  } satisfies Sqlite3Limits
} as const;

export function createSqlite3Command(options: Sqlite3CommandsOptions = {}): CommandDefinition {
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
        await writeText(
          context.stdout,
          "3.45.0 2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d\n"
        );
        return { exitCode: 0 };
      }
      if (arg === "-help" || arg === "--help") {
        await writeText(
          context.stdout,
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
      } else if (arg === "-column" || arg === "--column") {
        state.mode = "column";
        state.showHeaders = true;
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
      } else if (arg === "-html" || arg === "--html") {
        state.mode = "html";
      } else if (arg === "-ascii" || arg === "--ascii") {
        state.mode = "ascii";
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
      } else if (arg.startsWith("-")) {
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
        return typeof options.engine === "function"
          ? await options.engine({ dbPath, readonly, context })
          : options.engine;
      }
      return new SqliteDatabase();
    };

    const db: SqliteEngineInstance = await createDbInstance(state.dbPath, state.readonly);

    const execSingleStmt = async (stmt: string): Promise<QueryResultSet | null> => {
      if (typeof db.executeStatement === "function") {
        return await db.executeStatement(stmt);
      }
      if (typeof db.exec === "function") {
        const sets = await db.exec(stmt);
        return sets[sets.length - 1] ?? null;
      }
      return null;
    };

    const loadDbFromDisk = async (path: string) => {
      if (path === ":memory:") {
        return;
      }
      try {
        if (await vfsExists(context.fs, path)) {
          const bytes = await context.fs.readFile(path);
          if (typeof db.loadFromBytes === "function") {
            await db.loadFromBytes(bytes);
          }
        }
      } catch (err) {
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
        await context.fs.writeFile(path, bytes);
      }
    };

    try {
      await loadDbFromDisk(state.dbPath);
    } catch (err) {
      await writeText(context.stderr, `${err instanceof Error ? err.message : String(err)}\n`);
      return { exitCode: 1 };
    }

    const emitOutput = async (text: string) => {
      if (!text) {
        return;
      }
      if (state.onceFile) {
        const target = resolveVfsPath(context.cwd, state.onceFile);
        state.onceFile = null;
        await context.fs.writeFile(target, textEncoder.encode(text));
        return;
      }
      if (state.outputFile && state.outputFile !== "stdout") {
        const target = resolveVfsPath(context.cwd, state.outputFile);
        let prev = "";
        if (await vfsExists(context.fs, target)) {
          prev = await vfsReadText(context.fs, target);
        }
        await context.fs.writeFile(target, textEncoder.encode(prev + text));
        return;
      }
      await writeText(context.stdout, text);
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
        const newMode = (parts[1] ?? "list").toLowerCase();
        if (
          [
            "list",
            "csv",
            "column",
            "line",
            "json",
            "tabs",
            "html",
            "markdown",
            "box",
            "table",
            "quote",
            "ascii",
            "insert"
          ].includes(newMode)
        ) {
          state.mode = newMode as OutputMode;
          if (newMode === "csv") {
            state.colSeparator = ",";
          } else if (newMode === "tabs") {
            state.colSeparator = "\t";
          } else if (newMode === "insert" && parts[2]) {
            state.insertTable = parts[2];
          } else if (["column", "table", "box", "markdown"].includes(newMode) && parts[2] === undefined) {
            state.showHeaders = true;
          }
        }
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
          await context.fs.writeFile(abs, new Uint8Array(0));
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
            .sort((a, b) => a.localeCompare(b));
        } else {
          const res = await execSingleStmt("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name;");
          names = (res?.rows ?? []).map((r) => String(r[0] ?? ""));
        }
        const filtered = pattern
          ? names.filter((n) =>
              pattern.includes("%") || pattern.includes("_")
                ? new RegExp(`^${pattern.replace(/%/g, ".*").replace(/_/g, ".")}$`, "i").test(n)
                : matchGlob(n.toLowerCase(), pattern.toLowerCase()) || n.toLowerCase().includes(pattern.toLowerCase())
            )
          : names;
        if (filtered.length > 0) {
          await emitOutput(`${filtered.join("  ")}\n`);
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
        const idxList = db.indexes ? [...db.indexes.values()] : [];
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
        const dumpLines: string[] = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
        for (const tbl of db.tables?.values() ?? []) {
          if (pattern && !matchGlob(tbl.name.toLowerCase(), pattern.toLowerCase()) && tbl.name.toLowerCase() !== pattern.toLowerCase()) {
            continue;
          }
          dumpLines.push(`${tbl.sql.replace(/;*\s*$/, "")};`);
          for (const r of tbl.rows) {
            const vals = tbl.columns.map((c) => formatSqlQuote(r.data[c.name] ?? null)).join(",");
            dumpLines.push(`INSERT INTO ${tbl.name} VALUES(${vals});`);
          }
        }
        for (const idx of db.indexes?.values() ?? []) {
          if (!pattern || idx.tableName.toLowerCase() === pattern.toLowerCase()) {
            dumpLines.push(`${idx.sql.replace(/;*\s*$/, "")};`);
          }
        }
        for (const v of db.views?.values() ?? []) {
          if (!pattern || v.name.toLowerCase() === pattern.toLowerCase()) {
            dumpLines.push(`${v.sql.replace(/;*\s*$/, "")};`);
          }
        }
        for (const tr of db.triggers?.values() ?? []) {
          if (!pattern || tr.tableName.toLowerCase() === pattern.toLowerCase()) {
            dumpLines.push(`${tr.sql.replace(/;*\s*$/, "")};`);
          }
        }
        dumpLines.push("COMMIT;");
        await emitOutput(`${dumpLines.join("\n")}\n`);
        return;
      }

      if (cmd === ".import") {
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
        const content = await vfsReadText(context.fs, filePath);
        const sep = csvOverride || state.mode === "csv" ? (state.colSeparator === "|" ? "," : state.colSeparator) : state.colSeparator;
        const parsedRows = parseCsvContent(content, sep).slice(skipRows);
        if (parsedRows.length === 0) {
          return;
        }
        let tbl = db.findTable ? db.findTable(tableArg) : undefined;
        let dataRows = parsedRows;
        let colCount = tbl ? tbl.columns.length : (parsedRows[0]?.length ?? 0);
        if (!tbl) {
          const headerCols = parsedRows[0]!;
          colCount = headerCols.length;
          dataRows = parsedRows.slice(1);
          const createSql = `CREATE TABLE "${tableArg}"(${headerCols.map((c) => `"${c}" TEXT`).join(", ")})`;
          await execSingleStmt(createSql);
          tbl = db.findTable ? db.findTable(tableArg) : undefined;
        }
        for (const r of dataRows) {
          if (r.length === 1 && r[0] === "" && colCount > 1) {
            continue;
          }
          const valsSql = Array.from({ length: colCount }, (_, cIdx) => `'${(r[cIdx] ?? "").replace(/'/g, "''")}'`).join(", ");
          await execSingleStmt(`INSERT INTO "${tbl ? tbl.name : tableArg}" VALUES (${valsSql})`);
        }
        state.dirty = true;
        return;
      }

      if (cmd === ".read") {
        const filePath = resolveVfsPath(context.cwd, parts[1] ?? "");
        const script = await vfsReadText(context.fs, filePath);
        await processScript(script);
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

      if (cmd === ".parameter") {
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
      }
    };

    const runSqlStatement = async (stmt: string): Promise<void> => {
      if (state.echo) {
        await emitOutput(`${stmt}\n`);
      }
      const upper = stmt.trim().toUpperCase();
      const isMutating =
        upper.startsWith("CREATE") ||
        upper.startsWith("DROP") ||
        upper.startsWith("ALTER") ||
        upper.startsWith("INSERT") ||
        upper.startsWith("REPLACE") ||
        upper.startsWith("UPDATE") ||
        upper.startsWith("DELETE") ||
        upper.startsWith("VACUUM") ||
        (upper.startsWith("PRAGMA") && stmt.includes("="));

      if (state.readonly && isMutating) {
        throw new Error("attempt to write a readonly database");
      }

      const res = await execSingleStmt(stmt);
      if (isMutating) {
        state.dirty = true;
      }
      if (res) {
        const formatted = formatQueryResult(res, state);
        await emitOutput(formatted);
      }
      if (state.changes && isMutating) {
        await emitOutput(`changes: ${db.lastChanges ?? 0}   total_changes: ${db.totalChanges ?? 0}\n`);
      }
    };

    const processScript = async (script: string): Promise<boolean> => {
      // Process script mixing dot-commands (lines starting with '.') and SQL statements
      const lines = script.split(/\r?\n/);
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

      for (const line of lines) {
        const trimmed = line.trim();
        if (sqlBuffer.length === 0 && trimmed.startsWith(".") && !/^\.\d/.test(trimmed)) {
          try {
            await executeDotCommand(trimmed);
          } catch (err) {
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
          if (trimmed.endsWith(";") && !/\bBEGIN\b/i.test(sqlBuffer.join("\n"))) {
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
        const initContent = await vfsReadText(context.fs, resolveVfsPath(context.cwd, initFile));
        await processScript(initContent);
      } catch (err) {
        await writeText(context.stderr, `Error: cannot read init file "${initFile}": ${err instanceof Error ? err.message : String(err)}\n`);
        return { exitCode: 1 };
      }
    }

    for (const cmdStr of preCommands) {
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
        const stdinBytes = await collectBytes(context.stdin, { signal: context.signal });
        if (stdinBytes.byteLength > 0) {
          const stdinText = textDecoder.decode(stdinBytes);
          await processScript(stdinText);
        }
      }
    }

    if (state.dirty && state.dbPath !== ":memory:" && !state.readonly) {
      await saveDbToDisk(state.dbPath);
    }

    return { exitCode: state.exitCode };
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
