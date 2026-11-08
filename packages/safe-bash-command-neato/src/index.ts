import {
  layoutCommand,
  plugin,
  type GraphvizCommandsOptions,
  type GraphvizLimits
} from "safe-bash-graphviz-engine";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
export type NeatoLimits = GraphvizLimits;
export type NeatoCommandsOptions = GraphvizCommandsOptions;
export function createNeatoCommand(options: NeatoCommandsOptions = {}): CommandDefinition {
  return layoutCommand("neato", options);
}
export function createNeatoCommands(
  options: NeatoCommandsOptions = {}
): readonly CommandDefinition[] {
  return [createNeatoCommand(options)];
}
export function neatoCommands(options: NeatoCommandsOptions = {}): VirtualShellPlugin {
  return plugin("neato-commands", createNeatoCommands(options), options.replace);
}
