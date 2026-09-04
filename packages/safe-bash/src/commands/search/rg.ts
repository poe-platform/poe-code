import type { CommandDefinition } from "../../contracts/index.js";
import { RegexExecutor } from "../regex-execution/client.js";
import { createRgCommand } from "./rg-command.js";
import type { SearchOptions } from "./options.js";

export function rgCommand(options: SearchOptions = {}): CommandDefinition {
  return createRgCommand(new RegexExecutor(options.regex), options);
}
