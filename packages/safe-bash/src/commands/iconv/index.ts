import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createIconvCommand } from "./command.js";
import type { IconvCommandsOptions } from "./internal.js";

export { createIconvCommand } from "./command.js";
export type { IconvCommandsOptions, IconvLimits } from "./internal.js";

export function createIconvCommands(options: IconvCommandsOptions = {}): readonly CommandDefinition[] { return [createIconvCommand(options)]; }

export function iconvCommands(options: IconvCommandsOptions = {}): VirtualShellPlugin {
  const commands = createIconvCommands(options);
  return { name: "iconv-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
