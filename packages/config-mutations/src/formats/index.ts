import type { ConfigFormat } from "../types.js";
import { jsonFormat } from "./json.js";
import { tomlFormat } from "./toml.js";

export type FormatName = "json" | "toml";

const formatRegistry: Record<FormatName, ConfigFormat> = {
  json: jsonFormat,
  toml: tomlFormat
};

const extensionMap: Record<string, FormatName> = {
  ".json": "json",
  ".toml": "toml"
};

/**
 * Get a format handler by path (auto-detect from extension) or explicit format name.
 */
export function getConfigFormat(pathOrFormat: string): ConfigFormat {
  // Check if it's an explicit format name
  if (pathOrFormat in formatRegistry) {
    return formatRegistry[pathOrFormat as FormatName];
  }

  // Try to detect from extension
  const ext = getExtension(pathOrFormat);
  const formatName = extensionMap[ext];

  if (!formatName) {
    throw new Error(
      `Unsupported config format. Cannot detect format from "${pathOrFormat}". ` +
        `Supported extensions: ${Object.keys(extensionMap).join(", ")}. ` +
        `Supported format names: ${Object.keys(formatRegistry).join(", ")}.`
    );
  }

  return formatRegistry[formatName];
}

/**
 * Detect format name from a file path.
 */
export function detectFormat(path: string): FormatName | undefined {
  const ext = getExtension(path);
  return extensionMap[ext];
}

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) {
    return "";
  }
  return path.slice(lastDot).toLowerCase();
}

export { jsonFormat } from "./json.js";
export { tomlFormat } from "./toml.js";
