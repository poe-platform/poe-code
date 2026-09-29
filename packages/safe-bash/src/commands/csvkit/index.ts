import { evalSyncCsvlook, evalSyncCsvjson, evalSyncCsvsort, evalSyncCsvformat, evalSyncCsvstat, evalSyncIn2csv, evalSyncCsvstack, evalSyncCsvjoin } from "./sync.js";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createCsvkitCommands as createRawCsvkitCommands, type CsvkitCommandsOptions } from "safe-bash-command-csvkit";
export * from "safe-bash-command-csvkit";
export * from "./sync.js";

function isDefaultCsvkitOptions(options?: CsvkitCommandsOptions): boolean {
  if (!options) return true;
  return (
    options.limits === undefined &&
    options.codecs === undefined &&
    options.locale === undefined &&
    options.clock === undefined &&
    options.terminal === undefined &&
    options.compression === undefined &&
    options.databases === undefined &&
    options.sqlDialects === undefined &&
    options.interpreter === undefined &&
    options.openMatchFile === undefined &&
    options.sniffing === undefined &&
    options.columnWarnings === undefined &&
    options.probeInputOpen === undefined
  );
}

export function createCsvkitCommands(options: CsvkitCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawCsvkitCommands(options);
  Object.assign(syncCommandEvaluators, { evalSyncCsvlook, evalSyncCsvjson, evalSyncCsvsort, evalSyncCsvformat, evalSyncCsvstat, evalSyncIn2csv, evalSyncCsvstack, evalSyncCsvjoin });
  if (isDefaultCsvkitOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function csvkitCommands(options: CsvkitCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCsvkitCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "csvkit-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          const existing = host.commands.get(command.name);
          if (existing && !(command.fallback && !existing.fallback)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace });
      }
    },
  };
}
