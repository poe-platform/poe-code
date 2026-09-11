import type { CommandDefinition } from "../../contracts/index.js";
import { RegexExecutor } from "../regex-execution/portable.js";
import { createBoundedRegexProvider } from "../regex-execution/bounded-provider.js";
import { createRgCommand } from "./rg-command.js";
import type { SearchOptions } from "./options.js";

export function rgCommand(options: SearchOptions = {}): CommandDefinition {
  const provider = options.regexExecutor === undefined ? createBoundedRegexProvider() : options.regexExecutor;
  return createRgCommand(new RegexExecutor(provider, options.regex), options);
}
