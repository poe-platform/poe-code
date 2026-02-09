import { ValidationError } from "./errors.js";

export type McpOutputFormat = "url" | "base64" | "markdown" | "markdown_instructions";

export function parseMcpOutputFormatPreferences(
  value: string | undefined
): McpOutputFormat[] {
  if (value === undefined) {
    return ["url"];
  }

  const rawParts = value.split(",");
  const preferences: McpOutputFormat[] = [];

  for (const raw of rawParts) {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new ValidationError(
        `Invalid --output-format: empty entry in "${value}". ` +
          `Use "url", "base64", "markdown", "markdown_instructions", or a comma-separated list like "base64,url".`
      );
    }

    if (
      normalized !== "url" &&
      normalized !== "base64" &&
      normalized !== "markdown" &&
      normalized !== "markdown_instructions"
    ) {
      throw new ValidationError(
        `Invalid --output-format entry "${raw.trim()}". ` +
          `Expected "url", "base64", "markdown", or "markdown_instructions".`
      );
    }

    preferences.push(normalized as McpOutputFormat);
  }

  const standaloneFormats: McpOutputFormat[] = ["markdown", "markdown_instructions"];
  for (const standalone of standaloneFormats) {
    if (preferences.includes(standalone) && preferences.length > 1) {
      throw new ValidationError(
        `${standalone} output format cannot be combined with other formats. Use ${standalone} alone or choose a different format combination.`
      );
    }
  }

  return preferences;
}
