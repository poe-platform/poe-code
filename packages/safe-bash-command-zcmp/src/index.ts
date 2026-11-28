import { commandRuntimeIdentity, getCommandArguments, withInputByteBudget, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { define } from "safe-bash-io-engine/internal";
import { type GzipHelperOptions } from "safe-bash-compression-engine/decoded-input";
import { createCmpCommand } from "safe-bash-command-cmp";
import { decodedContext } from "safe-bash-compression-engine/decoded-input";
import { options as parseOptions } from "safe-bash-io-engine/internal";

export interface ZcmpLimits { readonly maxDecodedBytes: number; }
export type ZcmpCommandsOptions = GzipHelperOptions;

export function createZcmpCommand(options: ZcmpCommandsOptions = {}): CommandDefinition {
  const utility = createCmpCommand();
  const command = define("zcmp", async context => {
    if (context.args.includes("--help") || context.args.includes("--version")) return utility.execute(context);
    const files = parseOptions(context.args, "bcli:n:sv", { "print-bytes": "b", "print-chars": "c", "ignore-initial": "i", verbose: "l", bytes: "n", silent: "s", quiet: "s", version: "v", help: false }).operands;
    if (files.length === 1 && files[0]!.endsWith(".gz")) {
      const carrier = getCommandArguments(context);
      const args = carrier.concat(carrier.withValues([files[0]!.slice(0, -3)]));
      context = { ...context, args: args.args, argumentValues: args };
    }
    return utility.execute(decodedContext(context, options));
  }, 2);
  return { ...command, runtimeIdentity: commandRuntimeIdentity, execute: withInputByteBudget(async context => command.execute(context)) };
}

export function createZcmpCommands(options: ZcmpCommandsOptions = {}): readonly CommandDefinition[] {
  return [createZcmpCommand(options)];
}

export function zcmpCommands(options: ZcmpCommandsOptions = {}): VirtualShellPlugin {
  const commands = createZcmpCommands(options);
  return { name: "zcmp-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
