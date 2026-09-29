import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  CsvBudget,
  CsvParser,
  generatedHeaders,
  parseCsvcutArguments,
  resolveColumns,
  serializeRow,
  createCsvcutCommand as createRawCsvcutCommand,
  createCsvcutCommands as createRawCsvcutCommands,
  csvcutCommand as rawCsvcutCommand,
  type CsvDialect,
  type CsvRow,
  type CsvcutCommandOptions,
  type CsvcutCommandsOptions,
} from "safe-bash-command-csvcut";

export * from "safe-bash-command-csvcut";

builtInDirectContextExecutors.add(rawCsvcutCommand.execute);

export function createCsvcutCommand(options?: CsvcutCommandOptions): CommandDefinition {
  const def = createRawCsvcutCommand(options);
  if (options?.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export const csvcutCommand: CommandDefinition = rawCsvcutCommand;

export function createCsvcutCommands(options?: CsvcutCommandsOptions): readonly CommandDefinition[] {
  const defs = createRawCsvcutCommands(options);
  if (options?.limits === undefined) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function csvcutCommands(options: CsvcutCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCsvcutCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "csvcut",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

let _syncAbortSignal: AbortSignal | undefined;
const syncAbortSignal = (): AbortSignal => (_syncAbortSignal ??= new AbortController().signal);

export function evalSyncCsvcut(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (inBytes !== undefined && inBytes.byteLength > 16384) return undefined;
  const budget = new CsvBudget({}, syncAbortSignal());
  try {
    const supplied = parseCsvcutArguments(opArgs, budget);
    if (supplied.help || supplied.version) return undefined;
    if (supplied.encoding && supplied.encoding.toLowerCase() !== "utf-8" && supplied.encoding.toLowerCase() !== "utf-8-sig") {
      return undefined;
    }
    let sourceBytes = inBytes;
    if (supplied.filePath !== undefined && supplied.filePath !== "-") {
      if (!readFileSync) return undefined;
      const fileBytes = readFileSync(supplied.filePath);
      if (!fileBytes || fileBytes.byteLength > 16384) return undefined;
      sourceBytes = fileBytes;
    }
    if (supplied.names && supplied.headerless) return undefined;
    const dialect: CsvDialect = { ...supplied.dialect, profile: supplied.dialect?.profile ?? "utf8-sig-permissive-v1" };
    if (Number.isSafeInteger(dialect.skipLines) && dialect.skipLines! < 0) dialect.skipLines = 0;
    if (sourceBytes === undefined) return undefined;
    const parser = new CsvParser(dialect, budget);
    const rows: CsvRow[] = [...parser.push(sourceBytes), ...parser.end()];
    const first = rows[0];
    if (supplied.names && !first) return undefined;
    const headers = supplied.headerless ? generatedHeaders(first?.cells.length ?? 0, budget) : first?.cells ?? [];
    let out = supplied.addBom ? "\ufeff" : "";
    if (supplied.names) {
      for (let i = 0; i < headers.length; i++) {
        out += `${String(i + (supplied.zero ? 0 : 1)).padStart(3, " ")}: ${headers[i]}\n`;
      }
      return out;
    }
    const columns = headers.length ? resolveColumns(supplied, headers, budget) : [];
    const project = (cells: readonly string[]): string[] => {
      const projected: string[] = [];
      for (let i = 0; i < columns.length; i++) {
        projected.push(cells[columns[i]!] ?? "");
      }
      return projected;
    };
    const heading = project(headers);
    if (supplied.lineNumbers) heading.unshift("line_number");
    out += serializeRow(heading, budget);
    let number = 0;
    for (let i = supplied.headerless ? 0 : 1; i < rows.length; i++) {
      const cells = project(rows[i]!.cells);
      if (supplied.deleteEmptyRows && cells.every(c => c === "")) continue;
      if (supplied.lineNumbers) cells.unshift(String(++number));
      out += serializeRow(cells, budget);
    }
    return out;
  } catch {
    return undefined;
  } finally {
    budget.dispose();
  }
}
