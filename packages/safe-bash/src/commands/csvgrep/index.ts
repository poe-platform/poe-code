import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  CsvBudget,
  CsvParser,
  createMatcher,
  generatedHeaders,
  matchesRow,
  parseCsvgrepArguments,
  selectColumns,
  serializeRow,
  createCsvgrepCommand as createRawCsvgrepCommand,
  createCsvgrepCommands as createRawCsvgrepCommands,
  csvgrepCommand as rawCsvgrepCommand,
  type CsvgrepCommandOptions,
  type CsvgrepCommandsOptions,
} from "safe-bash-command-csvgrep";

export * from "safe-bash-command-csvgrep";

builtInDirectContextExecutors.add(rawCsvgrepCommand.execute);

export function createCsvgrepCommand(options?: CsvgrepCommandOptions): CommandDefinition {
  const def = createRawCsvgrepCommand(options);
  if (options?.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export const csvgrepCommand: CommandDefinition = rawCsvgrepCommand;

export function createCsvgrepCommands(options?: CsvgrepCommandsOptions): readonly CommandDefinition[] {
  const defs = createRawCsvgrepCommands(options);
  if (options?.limits === undefined) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function csvgrepCommands(options: CsvgrepCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCsvgrepCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "csvgrep",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

let _syncAbortSignal: AbortSignal | undefined;
const syncAbortSignal = (): AbortSignal => (_syncAbortSignal ??= new AbortController().signal);

export function evalSyncCsvgrep(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (inBytes.byteLength > 16384) return undefined;
  const budget = new CsvBudget({}, syncAbortSignal());
  try {
    const options = parseCsvgrepArguments(opArgs, budget);
    if (!options.names) {
      if (!options.columns) return undefined;
      const modes = [options.match !== undefined, options.regex !== undefined, options.file !== undefined].filter(Boolean).length;
      if (modes !== 1) return undefined;
    }
    if (options.names && options.headerless) return undefined;
    let fileMatchSet = new Set<string>();
    if (options.file !== undefined) {
      if (!readFileSync) return undefined;
      const patBytes = readFileSync(options.file);
      if (!patBytes || patBytes.byteLength > 16384) return undefined;
      const patText = new TextDecoder("utf-8", { fatal: false }).decode(patBytes);
      fileMatchSet = new Set(patText.split(/\r?\n/).filter(l => l.length > 0));
    }
    let sourceBytes = inBytes;
    if (options.filePath !== undefined && options.filePath !== "-") {
      if (!readFileSync) return undefined;
      const fileBytes = readFileSync(options.filePath);
      if (!fileBytes || fileBytes.byteLength > 16384) return undefined;
      sourceBytes = fileBytes;
    }
    const parser = new CsvParser(options.dialect ?? {}, budget);
    const rows = [...parser.push(sourceBytes), ...parser.end()];
    const matcher = options.names ? undefined : createMatcher(options, fileMatchSet, budget);
    let headers: readonly string[] | undefined;
    let columns: readonly number[] = [];
    let out = "";
    for (const row of rows) {
      if (headers === undefined) {
        headers = options.headerless
          ? generatedHeaders(row.cells.length + (options.lineNumbers ? 1 : 0), budget)
          : row.cells;
        if (options.lineNumbers && !options.headerless) {
          headers = ["line_numbers", ...headers];
        }
        if (options.names) {
          for (let i = 0; i < headers.length; i++) {
            out += `${String(i + (options.zero ? 0 : 1)).padStart(3)}: ${headers[i]}\n`;
          }
          return out;
        }
        columns = selectColumns(options.columns!, headers, options.zero ?? false, budget, undefined, options.lineNumbers ? 1 : 0);
        out += serializeRow(headers, budget);
        if (!options.headerless) continue;
      }
      const cells = options.lineNumbers
        ? [String(row.line - (options.headerless ? 0 : 1)), ...row.cells]
        : row.cells;
      if (matchesRow(cells, columns, matcher, options.any ?? false, options.invert ?? false, budget)) {
        out += serializeRow(cells, budget);
      }
    }
    if (headers === undefined) {
      if (options.names) return undefined;
      out += serializeRow([], budget);
    }
    return out;
  } catch {
    return undefined;
  } finally {
    budget.dispose();
  }
}
