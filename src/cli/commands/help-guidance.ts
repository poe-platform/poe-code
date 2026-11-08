import type { Command, Option } from "commander";

/**
 * Help metadata the commander help renderer cannot express itself: option sections and the
 * Examples/Notes blocks. Commands declare it; `formatSubcommandHelp` renders it through the
 * design system so every command's help reads the same way.
 */
const OPTION_GROUP = Symbol("poeOptionHelpGroup");
const HELP_GUIDANCE = Symbol("poeHelpGuidance");

export interface HelpGuidance {
  /** Copy-paste invocations rendered under `Examples:`, each prefixed with `$`. */
  examples: string[];
  /** Short prose rendered under `Notes:` for behaviour no single flag description owns. */
  notes?: string[];
}

/** Moves already-registered options of `command` out of `Options:` into named help sections. */
export function groupOptionsForHelp(
  command: Command,
  groups: Record<string, readonly string[]>
): void {
  for (const [group, flags] of Object.entries(groups)) {
    for (const flag of flags) {
      const option = command.options.find((candidate) => candidate.long === flag);
      if (option === undefined) {
        throw new Error(
          `Cannot group unknown option "${flag}" of "${command.name()}" under "${group}".`
        );
      }
      Reflect.set(option, OPTION_GROUP, group);
    }
  }
}

export function optionHelpGroup(option: Option): string | undefined {
  const group = Reflect.get(option, OPTION_GROUP);
  return typeof group === "string" ? group : undefined;
}

export function setHelpGuidance(command: Command, guidance: HelpGuidance): void {
  Reflect.set(command, HELP_GUIDANCE, guidance);
}

export function helpGuidance(command: Command): HelpGuidance | undefined {
  return Reflect.get(command, HELP_GUIDANCE) as HelpGuidance | undefined;
}

/** The dashboard exit keys, documented on every `--tui` flag so graceful quit is discoverable. */
export function dashboardTuiDescription(subject: string): string {
  return `Show a live dashboard while ${subject} is running (q quit, Ctrl+C force quit)`;
}
