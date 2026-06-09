import type { AgentPlugin } from "../runtime/plugin-types.js";
import { setResolvedPluginOptions } from "../runtime/provider-metadata.js";
import { builtinPluginRegistry } from "./registry.js";

export type PluginConfigEntry = {
  name: string;
  options?: unknown;
};

export class PluginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginConfigError";
  }
}

export function parsePluginConfigEntry(input: unknown): PluginConfigEntry {
  if (!isPlainObject(input)) {
    throw new PluginConfigError("agent.plugins: must be an object.");
  }

  for (const key of Object.keys(input)) {
    if (key !== "name" && key !== "options") {
      throw new PluginConfigError(`agent.plugins: unknown key "${key}".`);
    }
  }

  const name = hasOwnProperty(input, "name") ? input.name : undefined;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new PluginConfigError("agent.plugins.name: must be a non-empty string.");
  }

  const entry: PluginConfigEntry = { name: name.trim() };
  if (hasOwnProperty(input, "options")) {
    entry.options = input.options;
  }
  return entry;
}

export function parsePluginConfigEntries(input: unknown): PluginConfigEntry[] {
  if (!Array.isArray(input)) {
    throw new PluginConfigError("agent.plugins: must be an array.");
  }

  return input.map((value, index) => {
    try {
      return parsePluginConfigEntry(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid plugin config entry.";
      const replaced = message.startsWith("agent.plugins")
        ? message.replace("agent.plugins", `agent.plugins[${index}]`)
        : `agent.plugins[${index}]: ${message}`;
      throw new PluginConfigError(replaced);
    }
  });
}

export function parseNullablePluginConfigEntries(input: unknown): PluginConfigEntry[] | null {
  if (input === null) {
    return null;
  }
  return parsePluginConfigEntries(input);
}

export function resolvePluginsFromConfig(entries: PluginConfigEntry[]): AgentPlugin[] {
  const parsedEntries = parsePluginConfigEntries(entries);
  const seenNames = new Set<string>();
  const plugins: AgentPlugin[] = [];

  for (const [index, entry] of parsedEntries.entries()) {
    if (seenNames.has(entry.name)) {
      throw new PluginConfigError(`agent.plugins[${index}]: duplicate plugin "${entry.name}".`);
    }

    const spec = builtinPluginRegistry.get(entry.name);
    if (!spec) {
      throw createUnknownPluginError(index, entry.name);
    }

    let parsedOptions: unknown;
    try {
      parsedOptions = spec.parseOptions(entry.options ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid plugin options.";
      throw new PluginConfigError(`agent.plugins[${index}].options.${message}`);
    }

    plugins.push(setResolvedPluginOptions(spec.factory(parsedOptions), parsedOptions));
    seenNames.add(entry.name);
  }

  return plugins;
}

function createUnknownPluginError(index: number, name: string): PluginConfigError {
  const suggestions = getPluginSuggestions(name);
  const suggestionText =
    suggestions.length > 0 ? ` Did you mean ${formatSuggestions(suggestions)}?` : "";
  return new PluginConfigError(
    `agent.plugins[${index}]: unknown plugin "${name}".${suggestionText}`
  );
}

function getPluginSuggestions(name: string): string[] {
  return [...builtinPluginRegistry.keys()]
    .map((candidate) => ({
      name: candidate,
      distance: getLevenshteinDistance(name, candidate)
    }))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((candidate) => candidate.name);
}

function formatSuggestions(suggestions: string[]): string {
  if (suggestions.length === 1) {
    return `"${suggestions[0]}"`;
  }

  if (suggestions.length === 2) {
    return `"${suggestions[0]}" or "${suggestions[1]}"`;
  }

  const leading = suggestions
    .slice(0, -1)
    .map((suggestion) => `"${suggestion}"`)
    .join(", ");
  return `${leading}, or "${suggestions[suggestions.length - 1]}"`;
}

function getLevenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0]![col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + substitutionCost
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnProperty(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
