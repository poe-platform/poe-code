import type { CommandDefinition } from "../contracts/index.js";
import { RegexExecutor, type RegexExecutionOptions } from "./regex-execution/client.js";
import { createGrepCommands } from "./search/grep.js";

export function grepCommands(options: RegexExecutionOptions = {}): CommandDefinition[] {
  return createGrepCommands(new RegexExecutor(options));
}
