import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createTacCommand } from "./tac.js";
import { createExpandCommand } from "./expand.js";
import { createFoldCommand } from "safe-bash-command-fold/family";
import { createStringsCommand } from "./strings.js";
import { settings, type StreamInspectionCommandsOptions } from "./shared.js";
export type { StreamInspectionCommandsOptions, StreamInspectionLimits } from "./shared.js";

export function createStreamInspectionCommands(options: StreamInspectionCommandsOptions = {}): readonly CommandDefinition[] {
  const limits = settings(options);
  const defs = [createTacCommand(limits), createExpandCommand(limits), createFoldCommand(limits), createStringsCommand(limits)];
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function streamInspectionCommands(options: StreamInspectionCommandsOptions = {}): VirtualShellPlugin {
  const commands = createStreamInspectionCommands(options);
  return { name: "stream-inspection-commands", setup(host) {
    if (!options.replace) for (const definition of commands) {
      if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    }
    for (const definition of commands) host.commands.register(definition, { replace: options.replace ?? false });
  } };
}
