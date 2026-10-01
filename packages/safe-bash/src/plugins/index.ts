import { createPortableAgentCommands } from "./portable-commands.js";
import { createAgentCommandPlugin, createRegexExecutors } from "./base.js";
import { createGhCommands } from "../lazy-gh.js";
import type { CommandDefinition } from "../contracts/index.js";
import { composeAgentCommands, type AgentCommandsOptions } from "./composition.js";
import type { VirtualShellPlugin } from "../contracts/index.js";
import { agentWorkerRecipes, agentWorkerPlugins, captureAgentWorkerRecipe } from "./worker-recipes.js";

export type { AgentCommandsOptions } from "./composition.js";
export { baseAgentCommands, type BaseAgentCommandsOptions } from "./base.js";

export function createAgentCommands(options: AgentCommandsOptions = {}): readonly CommandDefinition[] {
  const commands = composeAgentCommands(options, createRegexExecutors(options), createGhCommands(options.gh), createPortableAgentCommands());
  const recipe = captureAgentWorkerRecipe(options);
  for (const command of commands) {
    if (recipe) agentWorkerRecipes.set(command.execute, recipe);
  }
  return commands;
}

export function agentCommands(options: AgentCommandsOptions = {}): VirtualShellPlugin {
  const regex = Object.freeze({ ...options.regex });
  const base = createAgentCommandPlugin({ ...options, regex }, createRegexExecutors({ ...options, regex }), createGhCommands(options.gh), createPortableAgentCommands());
  const recipe = captureAgentWorkerRecipe(options);
  const plugin: VirtualShellPlugin = {
    name: "agent-commands",
    setup(host) {
      const previous = new Map(host.commands.list().map(command => [command.name, command.execute]));
      base.setup(host);
      if (recipe) for (const definition of host.commands.list()) {
        if (previous.get(definition.name) !== definition.execute) agentWorkerRecipes.set(definition.execute, recipe);
      }
    },
    ...(base.dispose ? { dispose: base.dispose } : {}),
  };
  if (recipe) agentWorkerPlugins.add(plugin);
  return plugin;
}
