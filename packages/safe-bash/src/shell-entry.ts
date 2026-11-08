// A command-free entry: compose only the command plugins the application uses.
export * from "./shell/index.js";
export { CommandRegistry, commandRuntimeIdentity, createCommandArguments, getCommandArguments } from "./contracts/command.js";
export type { CommandDefinition, CommandContext } from "./contracts/command.js";
export type { VirtualShellPlugin, PluginHost } from "./contracts/plugin.js";
