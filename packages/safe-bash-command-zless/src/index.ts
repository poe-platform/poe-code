import { commandRuntimeIdentity, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { define } from "safe-bash-io-engine/internal";
import { type GzipHelperOptions } from "safe-bash-compression-engine/decoded-input";
import { createLessCommand } from "safe-bash-command-less";
import { decodedContext } from "safe-bash-compression-engine/decoded-input";

export interface ZlessLimits { readonly maxDecodedBytes: number; }
export type ZlessCommandsOptions = GzipHelperOptions;

export function createZlessCommand(options: ZlessCommandsOptions = {}): CommandDefinition {
  const utility = createLessCommand();
  const command = define("zless", async context => {
    return utility.execute(decodedContext(context, options));
  }, 2);
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZlessCommands(options: ZlessCommandsOptions = {}): readonly CommandDefinition[] {
  return [createZlessCommand(options)];
}

export function zlessCommands(options: ZlessCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZlessCommands(options);
  return { name: "zless-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
