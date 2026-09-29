import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createOpCommand as createRawOpCommand,
  createOpCommands as createRawOpCommands,
  evalSyncOp,
  type OpCommandContext,
  type OpCommandsOptions,
} from "safe-bash-command-op";

export * from "safe-bash-command-op";
export { evalSyncOp };

export function createOpCommand(options: OpCommandsOptions = {}): CommandDefinition & { execute(context: OpCommandContext): Promise<{ exitCode: number }> } {
  const def = createRawOpCommand(options);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createOpCommands(options: OpCommandsOptions = {}): readonly [CommandDefinition] {
  const defs = createRawOpCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function opCommands(options: OpCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOpCommands(options);
  return {
    name: "op-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

syncCommandEvaluators.evalSyncOp = evalSyncOp;
