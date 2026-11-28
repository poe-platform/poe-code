import { commandRuntimeIdentity, getCommandArguments, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { define } from "safe-bash-io-engine/internal";
import { type GzipHelperOptions } from "safe-bash-compression-engine/decoded-input";
import { createDiffCommand } from "safe-bash-command-diff";
import { decodedContext } from "safe-bash-compression-engine/decoded-input";
import { flags } from "safe-bash-command-diff/diff-options";

export interface ZdiffLimits { readonly maxDecodedBytes: number; }
export type ZdiffCommandsOptions = GzipHelperOptions;

export function createZdiffCommand(options: ZdiffCommandsOptions = {}): CommandDefinition {
  const utility = createDiffCommand();
  const command = define("zdiff", async context => {
    if (context.args.includes("--help") || context.args.includes("--version")) return utility.execute(context);
    const files = flags(context.args, true).files;
    if (files.length === 1 && files[0]!.endsWith(".gz")) {
      const carrier = getCommandArguments(context);
      const args = carrier.concat(carrier.withValues([files[0]!.slice(0, -3)]));
      context = { ...context, args: args.args, argumentValues: args };
    }
    return utility.execute(decodedContext(context, options));
  }, 2);
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZdiffCommands(options: ZdiffCommandsOptions = {}): readonly CommandDefinition[] {
  return [createZdiffCommand(options)];
}

export function zdiffCommands(options: ZdiffCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZdiffCommands(options);
  return { name: "zdiff-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
