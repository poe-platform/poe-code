import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "@poe-code/config-extends";
import { parse } from "yaml";
import { hasOwnErrorCode } from "../errors.js";
import type { ExperimentFileSystem, RunConfig } from "../types.js";

type RunConfigFileSystem = Pick<ExperimentFileSystem, "readFile" | "lstat">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOptionalFile(
  fs: RunConfigFileSystem,
  filePath: string
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function assertNoSymbolicLinks(fs: RunConfigFileSystem, filePath: string): Promise<void> {
  const absolutePath = path.resolve(filePath);
  const rootPath = path.parse(absolutePath).root;
  let currentPath = rootPath;

  for (const segment of absolutePath.slice(rootPath.length).split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);

    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        throw new Error("Experiment run config must not contain symbolic links.");
      }
    } catch (error) {
      if (isMissingPath(error)) {
        return;
      }

      throw error;
    }
  }
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function isPathInside(rootPath: string, filePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath));
}

function parseRunConfigYaml(filePath: string, content: string): unknown {
  try {
    return parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid experiment run config YAML in "${filePath}": ${message}`);
  }
}

function parseRunConfigData(filePath: string, document: unknown): RunConfig | null {
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

function parseRunConfigDocument(filePath: string, content: string): RunConfig | null {
  return parseRunConfigData(filePath, parseRunConfigYaml(filePath, content));
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

function createRunConfigResolveFs(
  fs: RunConfigFileSystem,
  globalConfigDir: string
): Pick<ExperimentFileSystem, "readFile"> {
  const bundledRunPath = fileURLToPath(new URL("./run.yaml", import.meta.url));

  return {
    async readFile(filePath, encoding) {
      if (filePath === bundledRunPath) {
        return readBundledFile("default-run.yaml");
      }

      if (isPathInside(globalConfigDir, filePath)) {
        await assertNoSymbolicLinks(fs, filePath);
      }

      return fs.readFile(filePath, encoding);
    }
  };
}

export async function loadInstructions(): Promise<string> {
  return readBundledFile("default-instructions.md");
}

export async function loadRunConfig(options: {
  cwd: string;
  homeDir: string;
  fs: RunConfigFileSystem;
}): Promise<RunConfig> {
  const projectPath = path.join(options.cwd, ".poe-code", "experiments", "run.yaml");
  await assertNoSymbolicLinks(options.fs, projectPath);
  const projectContent = await readOptionalFile(options.fs, projectPath);
  if (projectContent == null) {
    return readDefaultRunConfig();
  }

  const projectDocument = parseRunConfigYaml(projectPath, projectContent);
  if (projectDocument === null || projectDocument === undefined) {
    return readDefaultRunConfig();
  }

  const bundledConfigDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
  const globalConfigDir = path.resolve(path.join(options.homeDir, ".poe-code", "experiments"));
  const resolved = await resolve(
    [
      { source: "document", filePath: projectPath, content: projectContent },
      { source: "base", path: globalConfigDir },
      { source: "base", path: bundledConfigDir }
    ],
    { fs: createRunConfigResolveFs(options.fs, globalConfigDir) }
  );
  const config = parseRunConfigData(projectPath, resolved.data);

  if (!config) {
    throw new Error(`Invalid experiment run config in "${projectPath}": expected a top-level object.`);
  }

  return config;
}
