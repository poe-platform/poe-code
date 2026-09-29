import type { CommandDefinition } from "../../../contracts/index.js";
import { registerDefaultExecutors } from "../../internal.js";
import { createBase64Command } from "../../base64/index.js";
import { createBase32Command } from "../../base32/index.js";
import { createOdCommand } from "./od.js";
import { createXxdCommand } from "./xxd.js";
import { resolveInputLimit, type ByteInputOptions } from "../input-budget.js";

export function createEncodingCommands(options: ByteInputOptions = {}): readonly CommandDefinition[] {
  const maxInputBytes = resolveInputLimit(options);
  const definitions = [createBase64Command(options), createBase32Command(options), createXxdCommand({ maxInputBytes }), createOdCommand({ maxInputBytes })];
  return registerDefaultExecutors(definitions, options);
}
