import * as jsonc from "jsonc-parser";
import type { ConfigFormat, ConfigObject, ConfigValue } from "../types.js";
import { isConfigObject } from "../types.js";
import { cloneConfigObject, hasConfigEntry, setConfigEntry } from "./object.js";

function detectIndent(content: string): string {
  const match = content.match(/^[\t ]+/m);
  if (match) {
    return match[0];
  }
  return "  ";
}

function parse(content: string): ConfigObject {
  if (!content || content.trim() === "") {
    return {};
  }
  const errors: jsonc.ParseError[] = [];
  const parsed = jsonc.parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  if (errors.length > 0) {
    throw new Error(`JSON parse error: ${jsonc.printParseErrorCode(errors[0].error)}`);
  }
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (!isConfigObject(parsed)) {
    throw new Error("Expected JSON object.");
  }
  return cloneConfigObject(parsed);
}

function serialize(obj: ConfigObject): string {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function merge(base: ConfigObject, patch: ConfigObject): ConfigObject {
  const result = cloneConfigObject(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const existing = hasConfigEntry(result, key) ? result[key] : undefined;
    if (isConfigObject(existing) && isConfigObject(value)) {
      setConfigEntry(result, key, merge(existing, value));
      continue;
    }
    setConfigEntry(result, key, value as ConfigValue);
  }
  return result;
}

function configValuesEqual(left: ConfigValue | undefined, right: ConfigValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function prune(
  obj: ConfigObject,
  shape: ConfigObject
): { changed: boolean; result: ConfigObject } {
  let changed = false;
  const result = cloneConfigObject(obj);

  for (const [key, pattern] of Object.entries(shape)) {
    if (!hasConfigEntry(result, key)) {
      continue;
    }

    const current = result[key];

    // Empty object pattern means "delete this key entirely"
    if (isConfigObject(pattern) && Object.keys(pattern).length === 0) {
      delete result[key];
      changed = true;
      continue;
    }

    // Non-empty object pattern with object current: recurse
    if (isConfigObject(pattern) && isConfigObject(current)) {
      const { changed: childChanged, result: childResult } = prune(
        current,
        pattern
      );
      if (childChanged) {
        changed = true;
      }
      if (Object.keys(childResult).length === 0) {
        delete result[key];
      } else {
        setConfigEntry(result, key, childResult);
      }
      continue;
    }

    if (isConfigObject(pattern) && Object.keys(pattern).length > 0) {
      continue;
    }

    delete result[key];
    changed = true;
  }

  return { changed, result };
}

/**
 * Modify JSON content at a specific path while preserving comments and formatting.
 * Uses jsonc-parser's modify() for targeted updates.
 *
 * @param content - The original JSON content (may include comments)
 * @param path - JSON path array, e.g. ["mcpServers", "my-server"]
 * @param value - The value to set (or undefined to remove)
 * @returns The modified JSON content with comments preserved
 */
function modifyAtPath(
  content: string,
  path: (string | number)[],
  value: ConfigValue | undefined
): string {
  const indent = detectIndent(content);
  const formattingOptions: jsonc.FormattingOptions = {
    tabSize: indent === "\t" ? 1 : indent.length,
    insertSpaces: indent !== "\t",
    eol: "\n"
  };

  const edits = jsonc.modify(content, path, value, { formattingOptions });
  let result = jsonc.applyEdits(content, edits);

  if (!result.endsWith("\n")) {
    result += "\n";
  }

  return result;
}

/**
 * Merge a patch into JSON content while preserving comments and formatting.
 * Uses jsonc.modify() for each top-level key to preserve existing comments.
 *
 * @param content - The original JSON content (may include comments)
 * @param patch - Object with values to merge
 * @returns The modified JSON content with comments preserved
 */
function mergePreservingComments(
  content: string,
  patch: ConfigObject
): string {
  const current = parse(content);
  return serializeUpdate(content || "{}", current, merge(current, patch));
}

/**
 * Remove a key from JSON content while preserving comments and formatting.
 *
 * @param content - The original JSON content
 * @param path - JSON path array to the key to remove
 * @returns The modified JSON content with comments preserved
 */
function removeAtPath(content: string, path: (string | number)[]): string {
  return modifyAtPath(content, path, undefined);
}

function serializeUpdate(
  content: string,
  current: ConfigObject,
  next: ConfigObject
): string {
  let result = content || "{}";
  result = applyObjectUpdate(result, [], current, next);

  if (!result.endsWith("\n")) {
    result += "\n";
  }

  return result;
}

function applyObjectUpdate(
  content: string,
  path: (string | number)[],
  current: ConfigObject,
  next: ConfigObject
): string {
  let result = content;

  for (const key of Object.keys(current)) {
    if (!hasConfigEntry(next, key)) {
      result = removeAtPath(result, [...path, key]);
    }
  }

  for (const [key, nextValue] of Object.entries(next)) {
    const nextPath = [...path, key];
    const hasCurrent = hasConfigEntry(current, key);
    const currentValue = hasCurrent ? current[key] : undefined;

    if (hasCurrent && isConfigObject(currentValue) && isConfigObject(nextValue)) {
      result = applyObjectUpdate(result, nextPath, currentValue, nextValue);
      continue;
    }

    if (!hasCurrent || !configValuesEqual(currentValue, nextValue)) {
      result = modifyAtPath(result, nextPath, nextValue as ConfigValue);
    }
  }

  return result;
}

export {
  detectIndent,
  modifyAtPath,
  mergePreservingComments,
  removeAtPath,
  serializeUpdate
};

export const jsonFormat: ConfigFormat = {
  parse,
  serialize,
  serializeUpdate,
  merge,
  prune
};
