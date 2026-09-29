import type { CommandHandler } from "../../contracts/index.js";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import { parseCommand } from "safe-bash-command-ssconvert";

export * from "safe-bash-command-ssconvert";

export function evalSyncSsconvert(execute: CommandHandler, opArgs: readonly string[]): string | undefined {
  if (!builtInDirectContextExecutors.has(execute) || opArgs.length === 0) return undefined;
  try {
    const parsed = parseCommand(opArgs);
    if (parsed.kind === "terminal" && parsed.exitCode === 0 && !parsed.stderr && parsed.stdout) {
      return parsed.stdout;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncSsconvert = evalSyncSsconvert;
