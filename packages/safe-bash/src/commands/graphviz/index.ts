export * from "safe-bash-command-dot";
export * from "safe-bash-command-neato";
export * from "safe-bash-command-svgo";
export {
  parseDot,
  serializeDot,
  layoutGraph,
  renderSvg,
  optimizeSvg
} from "safe-bash-graphviz-engine";
import { createDotCommands, type DotCommandsOptions } from "safe-bash-command-dot";
import { createNeatoCommands } from "safe-bash-command-neato";
import { createSvgoCommands } from "safe-bash-command-svgo";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
export type GraphvizCommandsOptions = DotCommandsOptions;
export function createGraphvizCommands(
  options: GraphvizCommandsOptions = {}
): readonly CommandDefinition[] {
  return [
    ...createDotCommands(options),
    ...createNeatoCommands(options),
    ...createSvgoCommands(options)
  ];
}
export function graphvizCommands(options: GraphvizCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGraphvizCommands(options),
    replace = options.replace ?? false;
  return {
    name: "graphviz",
    setup(host) {
      if (!replace)
        for (const command of commands)
          if (host.commands.has(command.name))
            throw new Error(`Command already registered: ${command.name}`);
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}
