import "../../portable-buffer.js";
import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createSeqCommand } from "./seq.js";
import { createNlCommand } from "./nl.js";
import { createRevCommand } from "./rev.js";
import { createUnexpandCommand } from "./unexpand.js";
import { settings, type StreamFormatCommandsOptions } from "./shared.js";
export type { StreamFormatCommandsOptions, StreamFormatLimits } from "./shared.js";

export function createStreamFormatCommands(options: StreamFormatCommandsOptions = {}): readonly CommandDefinition[] {
  const limits = settings(options);
  const defs = [createSeqCommand(limits), createNlCommand(limits), createRevCommand(limits), createUnexpandCommand(limits)];
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function streamFormatCommands(options: StreamFormatCommandsOptions = {}): VirtualShellPlugin {
  const commands = createStreamFormatCommands(options);
  return { name: "stream-format-commands", setup(host) {
    if (!options.replace) for (const definition of commands) {
      if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    }
    for (const definition of commands) host.commands.register(definition, { replace: options.replace ?? false });
  } };
}
