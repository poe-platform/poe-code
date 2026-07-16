import { text } from "toolcraft-design";
import type { Command } from "commander";
import { ValidationError } from "../../errors.js";
import { parseSince } from "./jobs/shared.js";

export const defaultListLimit = 20;

export interface ListWindowFlags {
  limit?: string;
  since?: string;
  all?: boolean;
}

export interface ListWindow {
  since?: Date;
  limit?: number;
}

export function withListWindowOptions(command: Command, noun: string): Command {
  return command
    .option("--limit <count>", `Show at most this many ${noun}, newest first`, String(defaultListLimit))
    .option("--since <duration>", `Only show ${noun} newer than a duration, e.g. 7d`)
    .option("--all", `Show all ${noun}, ignoring --limit and --since`);
}

export function resolveListWindow(flags: ListWindowFlags): ListWindow {
  if (flags.all === true) {
    return {};
  }

  const since = parseSince(flags.since);
  const limit = parseLimit(flags.limit);
  return {
    ...(since === undefined ? {} : { since }),
    ...(limit === undefined ? {} : { limit })
  };
}

export function listWindowHint(window: ListWindow, shown: number, noun: string): string | undefined {
  if (window.limit === undefined || shown < window.limit) {
    return undefined;
  }

  return text.muted(
    `Showing the ${window.limit} newest ${noun}. Pass --limit <count>, --since <duration>, or --all to see more.`
  );
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError(`Invalid --limit "${value}". Expected a positive whole number.`);
  }
  return limit;
}
