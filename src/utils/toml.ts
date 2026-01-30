import { parse, stringify } from "@iarna/toml";

export type TomlValue =
  | boolean
  | number
  | string
  | Date
  | TomlValue[]
  | TomlTable;

export interface TomlTable {
  [key: string]: TomlValue;
}

export function parseTomlDocument(content: string): TomlTable {
  const result = parse(content);
  if (!isTomlTable(result)) {
    throw new Error("Expected TOML document to be a table.");
  }
  return result;
}

export function serializeTomlDocument(table: TomlTable): string {
  const serialized = stringify(table as any);
  return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

export function isTomlTable(value: unknown): value is TomlTable {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export interface TomlMergeOptions {
  pruneByPrefix?: Record<string, string>;
}

export function mergeTomlTables(
  target: TomlTable,
  source: TomlTable,
  options?: TomlMergeOptions
): TomlTable {
  const result: TomlTable = { ...target };
  const pruneByPrefix = options?.pruneByPrefix ?? {};

  for (const [key, value] of Object.entries(source)) {
    const current = result[key];
    const prefix = pruneByPrefix[key];

    if (isTomlTable(current) && isTomlTable(value)) {
      if (prefix) {
        const pruned = pruneKeysByPrefix(current, prefix);
        result[key] = { ...pruned, ...value };
      } else {
        result[key] = mergeTomlTables(current, value, options);
      }
      continue;
    }
    result[key] = value;
  }
  return result;
}

function pruneKeysByPrefix(table: TomlTable, prefix: string): TomlTable {
  const result: TomlTable = {};
  for (const [key, value] of Object.entries(table)) {
    if (!key.startsWith(prefix)) {
      result[key] = value;
    }
  }
  return result;
}
