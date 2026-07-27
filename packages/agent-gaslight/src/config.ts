import { promises as nodeFs } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { UserError } from "@poe-code/user-error";
import type { GaslightConfig, GaslightFileSystem } from "./types.js";

export const GASLIGHT_CONFIG_EXAMPLE = [
  "setup: Prepare the workspace",
  "prompt: Implement",
  "archive: true",
  "followups:",
  "  - Is this best you can do?",
  "  - Did you test it well? Like real end to end test?",
  "  - Did you forget something?",
  "teardown: Clean up the workspace"
].join("\n");

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function objectKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

export interface ParseGaslightConfigOptions {
  rejectExtraKeys?: boolean;
}

export function parseGaslightConfig(
  content: string,
  configPath: string,
  options: ParseGaslightConfigOptions = {}
): Omit<GaslightConfig, "path"> {
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid gaslight config at ${configPath}: ${message}`, { cause: error });
  }

  return validateConfig(parsed, configPath, options);
}

function validateConfig(
  value: unknown,
  configPath: string,
  options: ParseGaslightConfigOptions
): Omit<GaslightConfig, "path"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid gaslight config at ${configPath}: expected a YAML object.`);
  }

  const config = value as Record<string, unknown>;
  if (options.rejectExtraKeys) {
    const extraKey = objectKeys(config).find(
      (key) =>
        key !== "setup" &&
        key !== "prompt" &&
        key !== "followups" &&
        key !== "teardown" &&
        key !== "archive"
    );
    if (extraKey) {
      throw new Error(`Invalid gaslight config at ${configPath}: unexpected key "${extraKey}".`);
    }
  }
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
  if (config.archive !== undefined && typeof config.archive !== "boolean") {
    throw new Error(`Invalid gaslight config at ${configPath}: archive must be a boolean.`);
  }
  for (const key of ["setup", "teardown"] as const) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !config[key].trim())) {
      throw new Error(
        `Invalid gaslight config at ${configPath}: ${key} must be a non-empty string.`
      );
    }
  }

  return {
    ...(typeof config.setup === "string" ? { setup: config.setup.trim() } : {}),
    prompt: config.prompt.trim(),
    followups: config.followups.map((followup) => (followup as string).trim()),
    ...(typeof config.teardown === "string" ? { teardown: config.teardown.trim() } : {}),
    ...(config.archive !== undefined ? { archive: config.archive } : {})
  };
}

export async function loadGaslightConfig(
  cwd: string,
  homeDir: string,
  fs: GaslightFileSystem = nodeFs,
  configPath?: string
): Promise<GaslightConfig> {
  if (configPath) {
    const absoluteConfigPath = path.isAbsolute(configPath)
      ? configPath
      : path.join(cwd, configPath);
    let content: string;
    try {
      content = await fs.readFile(absoluteConfigPath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        throw new UserError(
          `Gaslight config not found: ${absoluteConfigPath}\n\nCreate one with "poe-code gaslight install", or point --config at an existing file.`,
          { cause: error }
        );
      }
      throw error;
    }

    return {
      ...parseGaslightConfig(content, absoluteConfigPath),
      path: absoluteConfigPath
    };
  }

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

    return { ...parseGaslightConfig(content, configPath), path: configPath };
  }

  throw new Error(
    `No gaslight config found. Searched:\n- ${paths[0]}\n- ${paths[1]}\n\nCreate one with:\n${GASLIGHT_CONFIG_EXAMPLE}`
  );
}
