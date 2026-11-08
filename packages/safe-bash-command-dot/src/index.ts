import {
  layoutCommand,
  plugin,
  type GraphvizCommandsOptions,
  type GraphvizLimits
} from "safe-bash-graphviz-engine";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
export type DotLimits = GraphvizLimits;
export type DotCommandsOptions = GraphvizCommandsOptions;
export function createDotCommand(options: DotCommandsOptions = {}): CommandDefinition {
  return layoutCommand("dot", options);
}
export function createDotCommands(options: DotCommandsOptions = {}): readonly CommandDefinition[] {
  return [createDotCommand(options)];
}
export function dotCommands(options: DotCommandsOptions = {}): VirtualShellPlugin {
  return plugin("dot-commands", createDotCommands(options), options.replace);
}
