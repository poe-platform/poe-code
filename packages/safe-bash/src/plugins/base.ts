import { RegexExecutor } from "../commands/regex-execution/portable.js";
import { createBoundedRegexProvider } from "../commands/regex-execution/bounded-provider.js";
import { commandExecutor, composeRawAgentCommands, type AgentCommandsOptions, type AgentRegexExecutors } from "./composition.js";
import type { CommandDefinition, VirtualShellPlugin } from "../contracts/index.js";

export type BaseAgentCommandsOptions = Omit<AgentCommandsOptions, "gh">;

export function createRegexExecutors(options: AgentCommandsOptions): AgentRegexExecutors {
  const provider = options.regexExecutor === undefined ? createBoundedRegexProvider() : options.regexExecutor;
  const executor = new RegexExecutor(provider, options.regex);
  const search = options.search?.regex === undefined ? executor : new RegexExecutor(provider, options.search.regex);
  return { grep: executor, aliases: executor, expr: executor, csplit: executor, search };
}


export function baseAgentCommands(options: BaseAgentCommandsOptions = {}): VirtualShellPlugin {
  const regex = Object.freeze({ ...options.regex });
  return createAgentCommandPlugin({ ...options, regex }, createRegexExecutors({ ...options, regex }));
}

export function createAgentCommandPlugin(
  options: BaseAgentCommandsOptions,
  executors: AgentRegexExecutors,
  additionalCommands: readonly CommandDefinition[] = [],
): VirtualShellPlugin {
  const regex = options.regex ?? {};
  let disposal: Promise<void> | undefined;
  const plugin: VirtualShellPlugin = {
    name: "base-agent-commands",
    setup(host) {
      if (disposal) throw new Error("Agent commands are disposed");
      host.provideCapabilities?.({ regex: { executor: executors.grep.provider, limits: regex } });
      const definitions = composeRawAgentCommands({ ...options, execute: options.execute ?? commandExecutor(name => host.commands.get(name)) }, executors, additionalCommands);
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
  return plugin;
}

