import type { RegexExecutionOptions } from "safe-bash-regex-engine/execution/protocol";
import type { BoundedRegexProvider } from "safe-bash-regex-engine/execution/provider";
export interface GrepAliasOptions {
  readonly regex?: RegexExecutionOptions;
  readonly regexExecutor?: BoundedRegexProvider;
  readonly replace?: boolean;
}