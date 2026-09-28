import type { CommandDefinition } from "safe-bash-contracts";
import { RegexExecutor, type RegexExecutionOptions } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import type { BoundedRegexProvider } from "safe-bash-regex-engine/execution/provider";
import { createGrepCommands, type GrepLimits } from "safe-bash-search-engine/grep";

export interface GrepCommandsOptions extends RegexExecutionOptions, GrepLimits {
  readonly regexExecutor?: BoundedRegexProvider;
}

export function grepCommands(options: GrepCommandsOptions = {}): CommandDefinition[] {
  const { regexExecutor, maxPatterns, maxPatternBytes, maxLineBytes, maxContextBytes, maxFileBytes, ...regex } = options;
  const provider = regexExecutor === undefined ? createBoundedRegexProvider() : regexExecutor;
  return createGrepCommands(new RegexExecutor(provider, regex), {
    ...(maxPatterns === undefined ? {} : { maxPatterns }),
    ...(maxPatternBytes === undefined ? {} : { maxPatternBytes }),
    ...(maxContextBytes === undefined ? {} : { maxContextBytes }),
    ...(maxLineBytes === undefined ? {} : { maxLineBytes }),
    ...(maxFileBytes === undefined ? {} : { maxFileBytes }),
  });
}
