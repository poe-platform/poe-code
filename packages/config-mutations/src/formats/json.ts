import * as jsonc from "jsonc-parser";
import type { ConfigFormat, ConfigObject, ConfigValue } from "../types.js";

function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  return parsed;
}

function serialize(obj: ConfigObject): string {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function merge(base: ConfigObject, patch: ConfigObject): ConfigObject {
  const result: ConfigObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const existing = result[key];
    if (isConfigObject(existing) && isConfigObject(value)) {
      result[key] = merge(existing, value);
      continue;
    }
    result[key] = value as ConfigValue;
  }
  return result;
}

function prune(
  obj: ConfigObject,
  shape: ConfigObject
): { changed: boolean; result: ConfigObject } {
  let changed = false;
  const result: ConfigObject = { ...obj };

  for (const [key, pattern] of Object.entries(shape)) {
    if (!(key in result)) {
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
        result[key] = childResult;
      }
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
  let result = content || "{}";

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    result = modifyAtPath(result, [key], value);
  }

  return result;
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

export { detectIndent, modifyAtPath, mergePreservingComments, removeAtPath };

export const jsonFormat: ConfigFormat = {
  parse,
  serialize,
  merge,
  prune
};
