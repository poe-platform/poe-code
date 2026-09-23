import { getNodeFsBridgeProvider } from "@poe-code/safe-fs";
import { resolvePluginFileSystem, type AgentRuntime } from "../runtime/filesystem.js";
import fsPromises from "node:fs/promises";
import os from "node:os";
import nativePath from "node:path";
import { hasOwnErrorCode } from "../error-codes.js";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { readOptionalString, rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
import type { PluginSpec } from "./registry.js";

const AGENTS_FILE = "AGENTS.md";
const USER_MEMORY_DIRECTORY = ".config/poe-code";

type MemoryPluginFileSystem = Pick<typeof fsPromises, "lstat" | "readFile" | "realpath">;

export type MemoryPluginOptions = {
  cwd?: string;
  homeDir?: string;
  fs?: MemoryPluginFileSystem;
};

export type MemoryPluginConfigOptions = Pick<MemoryPluginOptions, "cwd" | "homeDir">;

const memoryPlugin = (options: MemoryPluginOptions = {}): AgentPlugin => {
  const memories = new WeakMap<AgentRuntime, Promise<string | undefined>>();
  return {
    name: "poe-agent-plugin-memory",
    setup(api) { resolvePluginFileSystem(api.runtime, options.fs, fsPromises); },
    async prompt(ctx, runtime) {
      const fs = resolvePluginFileSystem(runtime, options.fs, fsPromises);
      const path = getNodeFsBridgeProvider(fs) ? nativePath.posix : nativePath;
      const cwd = path.resolve(runtime?.cwd ?? options.cwd ?? process.cwd(), options.cwd ?? ".");
      const homeDir = path.resolve(runtime?.homeDir ?? options.homeDir ?? os.homedir(), options.homeDir ?? ".");
      let pending = runtime ? memories.get(runtime) : undefined;
      if (!pending) {
        pending = loadMemory({ cwd, homeDir, fs });
        if (runtime) memories.set(runtime, pending);
      }
      const memory = await pending;

      if (!memory) {
        return ctx;
      }

      return {
        ...ctx,
        system: [memory, ctx.system].filter(Boolean).join("\n\n"),
      };
    },
  };
};

async function loadMemory(options: {
  cwd: string;
  homeDir: string;
  fs: MemoryPluginFileSystem;
}): Promise<string | undefined> {
  const path = getNodeFsBridgeProvider(options.fs) ? nativePath.posix : nativePath;
  const sections: string[] = [];
  const projectMemoryPath = await findNearestAgentsFile(options.cwd, options.fs);

  if (projectMemoryPath) {
    const projectMemory = await loadOptionalMemoryFile(
      projectMemoryPath,
      path.dirname(projectMemoryPath),
      options.fs,
    );
    if (projectMemory) {
      sections.push(formatMemorySection("Project memory", projectMemory));
    }
  }

  const userMemory = await loadOptionalMemoryFile(
    path.join(options.homeDir, USER_MEMORY_DIRECTORY, AGENTS_FILE),
    path.join(options.homeDir, USER_MEMORY_DIRECTORY),
    options.fs,
  );
  if (userMemory) {
    sections.push(formatMemorySection("User memory", userMemory));
  }

  if (sections.length === 0) {
    return undefined;
  }

  return sections.join("\n\n");
}

async function findNearestAgentsFile(
  cwd: string,
  fs: MemoryPluginFileSystem,
): Promise<string | undefined> {
  const path = getNodeFsBridgeProvider(fs) ? nativePath.posix : nativePath;
  let currentDirectory = cwd;

  while (true) {
    const filePath = path.join(currentDirectory, AGENTS_FILE);
    if (await exists(filePath, fs)) {
      return filePath;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = parentDirectory;
  }
}

async function loadOptionalMemoryFile(
  filePath: string,
  trustedDirectory: string,
  fs: MemoryPluginFileSystem,
): Promise<string | undefined> {
  const content = await readOptionalTrustedFile(filePath, trustedDirectory, fs);
  if (content === undefined) {
    return undefined;
  }

  return await expandImports({
    filePath,
    content,
    trustedDirectory,
    fs,
    loading: new Set<string>(),
  });
}

async function expandImports(options: {
  filePath: string;
  content: string;
  trustedDirectory: string;
  fs: MemoryPluginFileSystem;
  loading: Set<string>;
}): Promise<string | undefined> {
  const path = getNodeFsBridgeProvider(options.fs) ? nativePath.posix : nativePath;
  const normalizedPath = path.resolve(options.filePath);
  if (options.loading.has(normalizedPath)) {
    throw new Error(`Circular AGENTS.md import detected: ${normalizedPath}`);
  }

  options.loading.add(normalizedPath);

  try {
    const expandedLines: string[] = [];

    for (const line of normalizeLineEndings(options.content).split("\n")) {
      const importPath = parseImportPath(line);
      if (!importPath) {
        expandedLines.push(line);
        continue;
      }

      const importedFilePath = path.resolve(path.dirname(normalizedPath), importPath);
      assertPathContained(importedFilePath, options.trustedDirectory, "AGENTS.md import", path);
      const importedContent = await readRequiredTrustedFile(
        importedFilePath,
        options.trustedDirectory,
        options.fs,
      );
      const expandedImport = await expandImports({
        filePath: importedFilePath,
        content: importedContent,
        trustedDirectory: options.trustedDirectory,
        fs: options.fs,
        loading: options.loading,
      });

      if (expandedImport) {
        expandedLines.push(expandedImport);
      }
    }

    const expandedContent = expandedLines.join("\n").trim();
    return expandedContent.length > 0 ? expandedContent : undefined;
  } finally {
    options.loading.delete(normalizedPath);
  }
}

function parseImportPath(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("@")) {
    return undefined;
  }

  const importPath = trimmed.slice(1).trim();
  if (importPath.length === 0 || !isImportPath(importPath)) {
    return undefined;
  }

  return importPath;
}

function isImportPath(value: string): boolean {
  if (containsWhitespace(value)) {
    return false;
  }

  return (
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function containsWhitespace(value: string): boolean {
  for (const char of value) {
    if (char.trim().length === 0) {
      return true;
    }
  }

  return false;
}

function formatMemorySection(title: string, content: string): string {
  return `${title}:\n${content}`;
}

function normalizeLineEndings(content: string): string {
  return content.split("\r\n").join("\n");
}

async function readOptionalTrustedFile(
  filePath: string,
  trustedDirectory: string,
  fs: MemoryPluginFileSystem,
): Promise<string | undefined> {
  if (!(await exists(filePath, fs))) {
    return undefined;
  }

  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`AGENTS.md file escapes its trusted directory: ${filePath}`);
  }

  const [canonicalPath, canonicalDirectory] = await Promise.all([
    fs.realpath(filePath),
    fs.realpath(trustedDirectory),
  ]);
  assertPathContained(canonicalPath, canonicalDirectory, "AGENTS.md file", getNodeFsBridgeProvider(fs) ? nativePath.posix : nativePath);

  return await fs.readFile(filePath, "utf8");
}

async function readRequiredTrustedFile(
  filePath: string,
  trustedDirectory: string,
  fs: MemoryPluginFileSystem,
): Promise<string> {
  const content = await readOptionalTrustedFile(filePath, trustedDirectory, fs);
  if (content !== undefined) {
    return content;
  }

  throw new Error(`Missing AGENTS.md import: ${filePath}`);
}

async function exists(filePath: string, fs: MemoryPluginFileSystem): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function assertPathContained(filePath: string, trustedDirectory: string, label: string, path = nativePath): void {
  const relativePath = path.relative(trustedDirectory, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes its trusted directory: ${filePath}`);
  }
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

export default memoryPlugin;

export const spec: PluginSpec<MemoryPluginConfigOptions> = {
  name: "memory",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["cwd", "homeDir"]);
    const options: MemoryPluginConfigOptions = {};
    const cwd = readOptionalString(obj, "cwd");
    if (cwd !== undefined) {
      options.cwd = cwd;
    }
    const homeDir = readOptionalString(obj, "homeDir");
    if (homeDir !== undefined) {
      options.homeDir = homeDir;
    }
    return options;
  },
  factory: options => memoryPlugin(options),
};
