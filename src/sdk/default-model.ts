import * as fs from "node:fs/promises";
import * as os from "node:os";
import { resolveConfigPath } from "../cli/environment.js";
import {
  saveDefaultModel as saveDefaultModelToConfig,
  loadDefaultModels as loadDefaultModelsFromConfig,
  resolveDefaultModel as resolveDefaultModelFromConfig
} from "../services/config.js";
import type { DefaultModelsConfig } from "../services/config.js";

function buildFileSystem() {
  return {
    readFile: ((path: string, encoding?: BufferEncoding) => {
      if (encoding) return fs.readFile(path, encoding);
      return fs.readFile(path);
    }) as any,
    writeFile: (path: string, data: any, opts?: any) => fs.writeFile(path, data, opts),
    mkdir: (path: string, opts?: any) => fs.mkdir(path, opts).then(() => {}),
    stat: (path: string) => fs.stat(path),
    rm: (path: string, opts?: any) => fs.rm(path, opts),
    unlink: (path: string) => fs.unlink(path),
    readdir: (path: string) => fs.readdir(path),
    copyFile: (src: string, dest: string) => fs.copyFile(src, dest),
    chmod: (path: string, mode: number) => fs.chmod(path, mode)
  };
}

function getConfigFilePath(homeDir?: string): string {
  return resolveConfigPath(homeDir ?? os.homedir());
}

/**
 * Sets the default model for a tool or globally.
 *
 * @param key - The scope: `"global"` applies to all tools; a tool name (e.g. `"codex"`)
 *   applies to that specific tool; an endpoint path (e.g. `"/v1/responses"`) applies to
 *   that endpoint.
 * @param model - The model identifier to use as default (e.g. `"anthropic/claude-sonnet-4.6"`).
 * @param homeDir - Optional home directory override (defaults to `os.homedir()`).
 *
 * @example
 * // Set a global default for all tools
 * await setDefaultModel("global", "anthropic/claude-sonnet-4.6");
 *
 * // Set a default specifically for codex
 * await setDefaultModel("codex", "openai/gpt-5.2-codex");
 */
export async function setDefaultModel(
  key: string,
  model: string,
  homeDir?: string
): Promise<void> {
  await saveDefaultModelToConfig({
    fs: buildFileSystem(),
    filePath: getConfigFilePath(homeDir),
    key,
    model
  });
}

/**
 * Returns all configured default models.
 *
 * @param homeDir - Optional home directory override (defaults to `os.homedir()`).
 * @returns A record mapping keys to model identifiers. An empty object means no defaults configured.
 *
 * @example
 * const defaults = await getDefaultModels();
 * // { global: "anthropic/claude-sonnet-4.6", codex: "openai/gpt-5.2-codex" }
 */
export async function getDefaultModels(homeDir?: string): Promise<DefaultModelsConfig> {
  return loadDefaultModelsFromConfig({
    fs: buildFileSystem(),
    filePath: getConfigFilePath(homeDir)
  });
}

/**
 * Resolves the default model for a given key.
 *
 * Lookup order:
 * 1. Key-specific default (e.g. `"codex"`)
 * 2. Global default (`"global"`)
 * 3. `null` — no default configured
 *
 * @param key - Tool name or endpoint path to resolve the model for.
 * @param homeDir - Optional home directory override (defaults to `os.homedir()`).
 *
 * @example
 * const model = await resolveDefaultModel("codex");
 * // "openai/gpt-5.2-codex" (or the global default if no codex-specific one is set)
 */
export async function resolveDefaultModel(
  key: string,
  homeDir?: string
): Promise<string | null> {
  return resolveDefaultModelFromConfig({
    fs: buildFileSystem(),
    filePath: getConfigFilePath(homeDir),
    key
  });
}

export type { DefaultModelsConfig };
