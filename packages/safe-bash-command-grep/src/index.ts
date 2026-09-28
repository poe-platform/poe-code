import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { RegexExecutor, type RegexExecutionOptions } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import type { BoundedRegexProvider } from "safe-bash-regex-engine/execution/provider";
import { createGrepCommands as createSearchCommands, type GrepLimits } from "safe-bash-search-engine/grep";

export interface GrepCommandsOptions extends RegexExecutionOptions, GrepLimits {
  readonly regexExecutor?: BoundedRegexProvider;
  readonly replace?: boolean;
}

export function createGrepCommand(options: GrepCommandsOptions = {}): CommandDefinition {
  const { regexExecutor, maxPatterns, maxPatternBytes, maxLineBytes, maxContextBytes, maxFileBytes, ...regex } = options;
  const provider = regexExecutor === undefined ? createBoundedRegexProvider() : regexExecutor;
  return createSearchCommands(new RegexExecutor(provider, regex), {
    ...(maxPatterns === undefined ? {} : { maxPatterns }),
    ...(maxPatternBytes === undefined ? {} : { maxPatternBytes }),
    ...(maxContextBytes === undefined ? {} : { maxContextBytes }),
    ...(maxLineBytes === undefined ? {} : { maxLineBytes }),
    ...(maxFileBytes === undefined ? {} : { maxFileBytes }),
  })[0]!;
}

export type { GrepLimits } from "safe-bash-search-engine/grep";
export function createGrepCommands(options: GrepCommandsOptions = {}): readonly CommandDefinition[] {
  return [createGrepCommand(options)];
}
export function grepCommands(options: GrepCommandsOptions = {}): VirtualShellPlugin {
  const commands = createGrepCommands(options);
  const replace = options.replace ?? false;
  return { name: "grep-commands", setup(host) {
    if (!replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
