import type { Command } from "commander";
import { ValidationError } from "../errors.js";
import { isDecimalIntegerLiteral } from "./decimal-integer.js";

export type ActivityTimeoutCliOptions = {
  activityTimeoutMs?: number;
};

/**
 * Every runner that spawns an agent needs the same inactivity bound, otherwise an
 * unattended run has no CLI-level stop. Registered here so spawn and the multi-round
 * runners cannot drift apart on flag name, parsing, or help text.
 */
export function addActivityTimeoutOption<TCommand extends Command>(command: TCommand): TCommand {
  return command.option(
    "--activity-timeout-ms <ms>",
    "Kill the agent after N ms of inactivity",
    parseActivityTimeoutMs
  );
}

export function pickActivityTimeoutOptions(
  options: ActivityTimeoutCliOptions
): ActivityTimeoutCliOptions {
  return options.activityTimeoutMs === undefined
    ? {}
    : { activityTimeoutMs: options.activityTimeoutMs };
}

function parseActivityTimeoutMs(value: string): number {
  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!isDecimalIntegerLiteral(normalized) || !Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(
      `Invalid --activity-timeout-ms "${value}". Expected a positive integer.`
    );
  }
  return parsed;
}
