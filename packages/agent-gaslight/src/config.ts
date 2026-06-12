import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { GaslightConfig, GaslightFileSystem } from "./types.js";

const EXAMPLE_CONFIG = [
  "prompt: Implement",
  "followups:",
  "  - Is this best you can do?",
  "  - Did you test it well? Like real end to end test?",
  "  - Did you forget something?"
].join("\n");

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function validateConfig(value: unknown, configPath: string): Omit<GaslightConfig, "path"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid gaslight config at ${configPath}: expected a YAML object.`);
  }

  const config = value as Record<string, unknown>;
  if (typeof config.prompt !== "string" || config.prompt.trim().length === 0) {
    throw new Error(`Invalid gaslight config at ${configPath}: prompt must be a non-empty string.`);
  }
  if (
    !Array.isArray(config.followups) ||
    config.followups.length === 0 ||
    config.followups.some(
      (followup) => typeof followup !== "string" || followup.trim().length === 0
    )
  ) {
    throw new Error(
      `Invalid gaslight config at ${configPath}: followups must be a non-empty array of non-empty strings.`
    );
  }

  return {
    prompt: config.prompt.trim(),
    followups: config.followups.map((followup) => (followup as string).trim())
  };
}

export async function loadGaslightConfig(
  cwd: string,
  homeDir: string,
  fs: GaslightFileSystem = nodeFs
): Promise<GaslightConfig> {
  const paths = [
    path.join(cwd, ".poe-code", "gaslight.yaml"),
    path.join(homeDir, ".poe-code", "gaslight.yaml")
  ];

  for (const configPath of paths) {
    let content: string;
    try {
      content = await fs.readFile(configPath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        continue;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid gaslight config at ${configPath}: ${message}`, { cause: error });
    }
    return { ...validateConfig(parsed, configPath), path: configPath };
  }

  throw new Error(
    `No gaslight config found. Searched:\n- ${paths[0]}\n- ${paths[1]}\n\nCreate one with:\n${EXAMPLE_CONFIG}`
  );
}
