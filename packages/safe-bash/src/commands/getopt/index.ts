import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createGetoptCommand } from "./command.js";
import type { GetoptCommandsOptions } from "./internal.js";

export { createGetoptCommand } from "./command.js";
export type { GetoptCommandsOptions, GetoptLimits } from "./internal.js";

export function createGetoptCommands(options: GetoptCommandsOptions = {}): readonly CommandDefinition[] {
  return [createGetoptCommand(options)];
}

export function getoptCommands(options: GetoptCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGetoptCommands(options);
  return { name: "getopt-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
