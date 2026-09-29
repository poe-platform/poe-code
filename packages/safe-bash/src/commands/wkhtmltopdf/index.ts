import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createWkhtmltopdfCommand as createRawWkhtmltopdfCommand,
  createWkhtmltopdfCommands as createRawWkhtmltopdfCommands,
  parseInvocation,
  informationText,
  type WkhtmltopdfCommandOptions,
  type WkhtmltopdfCommandsOptions,
} from "safe-bash-command-wkhtmltopdf";

export * from "safe-bash-command-wkhtmltopdf";

export function createWkhtmltopdfCommand(options: WkhtmltopdfCommandOptions = {}): CommandDefinition {
  const def = createRawWkhtmltopdfCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createWkhtmltopdfCommands(options: WkhtmltopdfCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawWkhtmltopdfCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function wkhtmltopdfCommands(options: WkhtmltopdfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createWkhtmltopdfCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "wkhtmltopdf",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

export function evalSyncWkhtmltopdf(opArgs: readonly string[]): string | undefined {
  if (opArgs.length === 0) return undefined;
  try {
    const initial = parseInvocation(opArgs, { endOfOptions: true });
    if (initial.mode === "information") {
      return informationText(initial.global.action);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncWkhtmltopdf = evalSyncWkhtmltopdf;
