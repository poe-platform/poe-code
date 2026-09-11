import type { CommandDefinition } from "../contracts/index.js";
import { RegexExecutor } from "../commands/regex-execution/portable.js";
import { createBoundedRegexProvider } from "../commands/regex-execution/bounded-provider.js";
import { commandExecutor, composeAgentCommands, type AgentCommandsOptions, type AgentRegexExecutors } from "./composition.js";
import type { VirtualShellPlugin } from "../contracts/index.js";

export type { AgentCommandsOptions } from "./composition.js";

function createRegexExecutors(options: AgentCommandsOptions): AgentRegexExecutors {
  const provider = options.regexExecutor === undefined ? createBoundedRegexProvider() : options.regexExecutor;
  const executor = new RegexExecutor(provider, options.regex);
  const search = options.search?.regex === undefined ? executor : new RegexExecutor(provider, options.search.regex);
  return { grep: executor, aliases: executor, expr: executor, csplit: executor, search };
}

export function createAgentCommands(options: AgentCommandsOptions = {}): readonly CommandDefinition[] {
  return composeAgentCommands(options, createRegexExecutors(options));
}

export function agentCommands(options: AgentCommandsOptions = {}): VirtualShellPlugin {
  const executors = createRegexExecutors(options);
  let disposal: Promise<void> | undefined;
  return {
    name: "agent-commands",
    setup(host) {
      if (disposal) throw new Error("Agent commands are disposed");
      const definitions = composeAgentCommands({ ...options, execute: options.execute ?? commandExecutor(name => host.commands.get(name)) }, executors);
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
    dispose() {
      return disposal ??= (async () => {
        const owned = new Set([executors.grep, executors.search]);
        const results = await Promise.allSettled([...owned].map(executor => executor.dispose()));
        const errors = results.filter(result => result.status === "rejected").map(result => result.reason as unknown);
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "agent regex disposal failed");
      })();
    },
  };
}
