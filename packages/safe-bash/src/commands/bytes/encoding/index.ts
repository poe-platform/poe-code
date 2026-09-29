import type { CommandDefinition } from "../../../contracts/index.js";
import { registerDefaultExecutors } from "../../internal.js";
import { createBaseCommand } from "./base.js";
import { createOdCommand } from "./od.js";
import { createXxdCommand } from "./xxd.js";
import { resolveInputLimit, type ByteInputOptions } from "../input-budget.js";

export function createEncodingCommands(options: ByteInputOptions = {}): readonly CommandDefinition[] {
  const maxInputBytes = resolveInputLimit(options);
  const definitions = [createBaseCommand("base64", maxInputBytes), createBaseCommand("base32", maxInputBytes), createXxdCommand(maxInputBytes), createOdCommand(maxInputBytes)];
  return registerDefaultExecutors(definitions, options);
}
