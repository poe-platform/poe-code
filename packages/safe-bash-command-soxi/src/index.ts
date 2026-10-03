import {
  getCommandArguments,
  writeText,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { audioInfo, audioLimits, type SoxLimits } from "safe-bash-command-sox";
export type SoxiLimits = SoxLimits;
export interface SoxiCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<SoxiLimits>;
}
export function createSoxiCommand(options: SoxiCommandsOptions = {}): CommandDefinition {
  const limits = audioLimits(options);
  return {
    name: "soxi",
    description: "Inspect audio file properties",
    async execute(context) {
      context.signal.throwIfAborted();
      try {
        const args = getCommandArguments(context).args;
        if (args.includes("--help") || args.includes("-h"))
          await writeText(context.stdout, "Usage: soxi [-t|-r|-c|-s|-d|-D|-b|-B|-a] FILE...\n");
        else await audioInfo(context, args, limits);
        return { exitCode: 0 };
      } catch (error) {
        context.signal.throwIfAborted();
        await writeText(
          context.stderr,
          `soxi: ${error instanceof Error ? error.message : String(error)}\n`
        );
        return { exitCode: 1 };
      }
    }
  };
}
export function createSoxiCommands(
  options: SoxiCommandsOptions = {}
): readonly CommandDefinition[] {
  return [createSoxiCommand(options)];
}
export function soxiCommands(options: SoxiCommandsOptions = {}): VirtualShellPlugin {
  const command = createSoxiCommand(options);
  return {
    name: "soxi-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
