import { commandRuntimeIdentity, getCommandArguments, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { define } from "safe-bash-io-engine/internal";
import { type GzipHelperOptions } from "safe-bash-compression-engine/decoded-input";
import { createZgrepCommand, type ZgrepCommandsOptions } from "safe-bash-command-zgrep";

export interface ZegrepLimits { readonly maxDecodedBytes: number; }
export interface ZegrepCommandsOptions extends GzipHelperOptions, ZgrepCommandsOptions {}

export function createZegrepCommand(options: ZegrepCommandsOptions = {}): CommandDefinition {
  const grep = createZgrepCommand(options);
  const command = define("zegrep", async context => {
    const carrier = getCommandArguments(context);
    const args = carrier.withValues(["-E"]).concat(carrier);
    return grep.execute({ ...context, args: args.args, argumentValues: args });
  }, 2);
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZegrepCommands(options: ZegrepCommandsOptions = {}): readonly CommandDefinition[] {
  return [createZegrepCommand(options)];
}

export function zegrepCommands(options: ZegrepCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZegrepCommands(options);
  return { name: "zegrep-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
