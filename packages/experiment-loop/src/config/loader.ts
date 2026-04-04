import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { ExperimentFileSystem, RunConfig } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOptionalFile(
  fs: Pick<ExperimentFileSystem, "readFile">,
  filePath: string
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function parseRunConfigDocument(filePath: string, content: string): RunConfig | null {
  let document: unknown;
  try {
    document = parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid experiment run config YAML in "${filePath}": ${message}`);
  }

  if (document === null || document === undefined) {
    return null;
  }

  if (!isRecord(document)) {
    throw new Error(`Invalid experiment run config in "${filePath}": expected a top-level object.`);
  }

  const prompt = document.prompt;

  if (prompt === undefined) {
    throw new Error(`Missing "prompt" field in "${filePath}".`);
  }

  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error(`"prompt" must be a non-empty string in "${filePath}".`);
  }

  return { prompt };
}

async function readBundledFile(name: string): Promise<string> {
  const filePath = fileURLToPath(new URL(`./${name}`, import.meta.url));
  return readFile(filePath, "utf8");
}

async function readDefaultRunConfig(): Promise<RunConfig> {
  const content = await readBundledFile("default-run.yaml");
  const config = parseRunConfigDocument("default-run.yaml", content);

  if (!config) {
    throw new Error("default-run.yaml is empty or invalid.");
  }

  return config;
}

export async function loadInstructions(): Promise<string> {
  return readBundledFile("default-instructions.md");
}

export async function loadRunConfig(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<ExperimentFileSystem, "readFile">;
}): Promise<RunConfig> {
  const projectPath = path.join(options.cwd, ".poe-code", "experiments", "run.yaml");
  const globalPath = path.join(options.homeDir, ".poe-code", "experiments", "run.yaml");

  const projectContent = await readOptionalFile(options.fs, projectPath);
  if (projectContent != null) {
    const config = parseRunConfigDocument(projectPath, projectContent);
    if (config) {
      return config;
    }
  }

  const globalContent = await readOptionalFile(options.fs, globalPath);
  if (globalContent != null) {
    const config = parseRunConfigDocument(globalPath, globalContent);
    if (config) {
      return config;
    }
  }

  return readDefaultRunConfig();
}
