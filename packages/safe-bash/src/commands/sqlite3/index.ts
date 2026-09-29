import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createSqlite3Command as createRawSqlite3Command,
  createSqlite3Commands as createRawSqlite3Commands,
  evalSyncSqlite3,
  type Sqlite3CommandsOptions,
} from "safe-bash-command-sqlite3";

export * from "safe-bash-command-sqlite3";

function isDefaultSqlite3Options(options?: Sqlite3CommandsOptions): boolean {
  if (!options) return true;
  return options.limits === undefined && options.engine === undefined;
}

export function createSqlite3Command(options: Sqlite3CommandsOptions = {}): CommandDefinition {
  const def = createRawSqlite3Command(options);
  if (isDefaultSqlite3Options(options)) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createSqlite3Commands(options: Sqlite3CommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawSqlite3Commands(options);
  if (isDefaultSqlite3Options(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
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
    },
  };
}

syncCommandEvaluators.evalSyncSqlite3 = evalSyncSqlite3;
