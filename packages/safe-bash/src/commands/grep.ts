import type { CommandDefinition } from "../contracts/index.js";
import { RegexExecutor, type RegexExecutionOptions } from "./regex-execution/portable.js";
import { createBoundedRegexProvider } from "./regex-execution/bounded-provider.js";
import type { BoundedRegexProvider } from "./regex-execution/provider.js";
import { createGrepCommands } from "./search/grep.js";

export interface GrepCommandsOptions extends RegexExecutionOptions {
  readonly regexExecutor?: BoundedRegexProvider;
}

export function grepCommands(options: GrepCommandsOptions = {}): CommandDefinition[] {
  const { regexExecutor, ...regex } = options;
  const provider = regexExecutor === undefined ? createBoundedRegexProvider() : regexExecutor;
  return createGrepCommands(new RegexExecutor(provider, regex));
}
