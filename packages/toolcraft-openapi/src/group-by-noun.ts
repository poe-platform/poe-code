import type { GeneratedCommand } from "./generate.js";

export interface GeneratedCommandGroup {
  noun: string;
  commands: GeneratedCommand[];
}

export function groupByNoun(
  commands: ReadonlyArray<GeneratedCommand>
): GeneratedCommandGroup[] {
  const groups = new Map<string, GeneratedCommand[]>();

  for (const command of commands) {
    if (command.topLevel) {
      continue;
    }
    const current = groups.get(command.noun);

    if (current === undefined) {
      groups.set(command.noun, [command]);
      continue;
    }

    current.push(command);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([noun, nounCommands]) => ({
      noun,
      commands: nounCommands.slice().sort((left, right) => left.verb.localeCompare(right.verb))
    }));
}
