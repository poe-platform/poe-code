import { baseAgentCommands, createRegexExecutors } from "./base.js";
import { createGhCommands } from "../lazy-gh.js";
import type { CommandDefinition } from "../contracts/index.js";
import { composeAgentCommands, type AgentCommandsOptions } from "./composition.js";
import type { VirtualShellPlugin } from "../contracts/index.js";
import { agentWorkerRecipes, agentWorkerPlugins, captureAgentWorkerRecipe } from "./worker-recipes.js";

export type { AgentCommandsOptions } from "./composition.js";
export { baseAgentCommands, type BaseAgentCommandsOptions } from "./base.js";

export function createAgentCommands(options: AgentCommandsOptions = {}): readonly CommandDefinition[] {
  const commands = composeAgentCommands(options, createRegexExecutors(options), createGhCommands(options.gh));
  const recipe = captureAgentWorkerRecipe(options);
  for (const command of commands) {
    if (recipe) agentWorkerRecipes.set(command.execute, recipe);
  }
  return commands;
}

export function agentCommands(options: AgentCommandsOptions = {}): VirtualShellPlugin {
  const base = baseAgentCommands(options);
  const recipe = captureAgentWorkerRecipe(options);
  const plugin: VirtualShellPlugin = {
    name: "agent-commands",
    setup(host) {
      const previous = new Map(host.commands.list().map(command => [command.name, command.execute]));
      const definitions = createGhCommands(options.gh);
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      base.setup(host);
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
      if (recipe) for (const definition of host.commands.list()) {
        if (previous.get(definition.name) !== definition.execute) agentWorkerRecipes.set(definition.execute, recipe);
      }
    },
    ...(base.dispose ? { dispose: base.dispose } : {}),
  };
  if (recipe) agentWorkerPlugins.add(plugin);
  return plugin;
}
