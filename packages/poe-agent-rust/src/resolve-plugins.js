import { native } from "./native.js";
import { setResolvedPluginOptions } from "./provider-metadata.js";
import { builtinPluginRegistry } from "./plugin-registry.js";
export class PluginConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginConfigError";
  }
}
export function parsePluginConfigEntry(input) {
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
  const entry = { name: name.trim() };
  if (hasOwnProperty(input, "options")) {
    entry.options = input.options;
  }
  return entry;
}
export function parsePluginConfigEntries(input) {
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
export function parseNullablePluginConfigEntries(input) {
  if (input === null) {
    return null;
  }
  return parsePluginConfigEntries(input);
}
export function resolvePluginsFromConfig(entries) {
  const parsedEntries = parsePluginConfigEntries(entries);
  const seenNames = new native.NativeAgentPluginNames();
  const plugins = [];
  for (const [index, entry] of parsedEntries.entries()) {
    if (seenNames.contains(entry.name)) {
      throw new PluginConfigError(`agent.plugins[${index}]: duplicate plugin "${entry.name}".`);
    }
    const spec = builtinPluginRegistry.get(entry.name);
    if (!spec) {
      throw createUnknownPluginError(index, entry.name);
    }
    let parsedOptions;
    try {
      parsedOptions = spec.parseOptions(entry.options ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid plugin options.";
      throw new PluginConfigError(`agent.plugins[${index}].options.${message}`);
    }
    plugins.push(setResolvedPluginOptions(spec.factory(parsedOptions), parsedOptions));
    seenNames.insert(entry.name);
  }
  return plugins;
}
function createUnknownPluginError(index, name) {
  const suggestions = getPluginSuggestions(name);
  const suggestionText =
    suggestions.length > 0 ? ` Did you mean ${formatSuggestions(suggestions)}?` : "";
  return new PluginConfigError(
    `agent.plugins[${index}]: unknown plugin "${name}".${suggestionText}`
  );
}
function getPluginSuggestions(name) {
  const candidates = [...builtinPluginRegistry.keys()],
    distances = native.agentPluginDistances(name, candidates);
  return candidates
    .map((candidate, index) => ({
      name: candidate,
      distance: distances[index]
    }))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((candidate) => candidate.name);
}
function formatSuggestions(suggestions) {
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
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOwnProperty(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
