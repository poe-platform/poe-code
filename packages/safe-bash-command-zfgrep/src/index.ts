import { commandRuntimeIdentity, getCommandArguments, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { define } from "safe-bash-io-engine/internal";
import { type GzipHelperOptions } from "safe-bash-compression-engine/decoded-input";
import { createZgrepCommand, type ZgrepCommandsOptions } from "safe-bash-command-zgrep";

export interface ZfgrepLimits { readonly maxDecodedBytes: number; }
export interface ZfgrepCommandsOptions extends GzipHelperOptions, ZgrepCommandsOptions {}

export function createZfgrepCommand(options: ZfgrepCommandsOptions = {}): CommandDefinition {
  const grep = createZgrepCommand(options);
  const command = define("zfgrep", async context => {
    const carrier = getCommandArguments(context);
    const args = carrier.withValues(["-F"]).concat(carrier);
    return grep.execute({ ...context, args: args.args, argumentValues: args });
  }, 2);
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZfgrepCommands(options: ZfgrepCommandsOptions = {}): readonly CommandDefinition[] {
  return [createZfgrepCommand(options)];
}

export function zfgrepCommands(options: ZfgrepCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZfgrepCommands(options);
  return { name: "zfgrep-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
