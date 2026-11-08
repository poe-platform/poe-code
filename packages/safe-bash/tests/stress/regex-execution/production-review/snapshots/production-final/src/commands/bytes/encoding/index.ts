import type { CommandDefinition } from "../../../contracts/index.js";
import { createBaseCommand } from "./base.js";
import { createOdCommand } from "./od.js";
import { createXxdCommand } from "./xxd.js";

export function createEncodingCommands(): readonly CommandDefinition[] {
  return [createBaseCommand("base64"), createBaseCommand("base32"), createXxdCommand(), createOdCommand()];
}
