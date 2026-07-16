import type { Command } from "commander";
import { ValidationError } from "../errors.js";
import { requireNonEmpty } from "../options.js";

export type SkillCliOptions = {
  skill?: string[];
  skills?: string[];
};

/**
 * `--skill` and `--skills` are two spellings of one list: both are repeatable and both
 * merge, so the help text has to say so or users assume one overrides the other.
 * Registered here so every runner that bridges skills offers the same pair.
 */
export function addSkillOptions<TCommand extends Command>(command: TCommand): TCommand {
  return command
    .option(
      "--skill <ref>",
      "Active skill reference to bridge for this run (repeatable; merged with --skills)",
      collectSkillOption
    )
    .option(
      "--skills <refs>",
      "Comma-separated active skill references to bridge for this run (repeatable; merged with --skill)",
      collectSkillsOption
    );
}

export function resolveSkillOptions(options: SkillCliOptions): string[] | undefined {
  const resolved = [...(options.skill ?? []), ...(options.skills ?? [])];
  return resolved.length > 0 ? resolved : undefined;
}

function collectSkillOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), requireNonEmpty(value, "--skill")];
}

function collectSkillsOption(value: string, previous: string[] | undefined): string[] {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new ValidationError("--skills cannot be empty.");
  }
  return [...(previous ?? []), ...entries];
}
