import { commandRuntimeIdentity, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { define } from "safe-bash-io-engine/internal";
import { type GzipHelperOptions } from "safe-bash-compression-engine/decoded-input";
import { createMoreCommand } from "safe-bash-command-more";
import { decodedContext } from "safe-bash-compression-engine/decoded-input";

export interface ZmoreLimits { readonly maxDecodedBytes: number; }
export type ZmoreCommandsOptions = GzipHelperOptions;

export function createZmoreCommand(options: ZmoreCommandsOptions = {}): CommandDefinition {
  const utility = createMoreCommand();
  const command = define("zmore", async context => {
    return utility.execute(decodedContext(context, options));
  }, 2);
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZmoreCommands(options: ZmoreCommandsOptions = {}): readonly CommandDefinition[] {
  return [createZmoreCommand(options)];
}

export function zmoreCommands(options: ZmoreCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZmoreCommands(options);
  return { name: "zmore-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
