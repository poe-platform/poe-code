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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnProperty(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
