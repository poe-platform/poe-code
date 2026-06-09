import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasOwnErrorCode } from "../error-codes.js";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { readOptionalString, rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
import type { PluginSpec } from "./registry.js";

const AGENTS_FILE = "AGENTS.md";
const USER_MEMORY_DIRECTORY = path.join(".config", "poe-code");

type MemoryPluginFileSystem = Pick<typeof fsPromises, "lstat" | "readFile" | "realpath">;

export type MemoryPluginOptions = {
  cwd?: string;
  homeDir?: string;
  fs?: MemoryPluginFileSystem;
};

export type MemoryPluginConfigOptions = Pick<MemoryPluginOptions, "cwd" | "homeDir">;

const memoryPlugin = (options: MemoryPluginOptions = {}): AgentPlugin => {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const fs = options.fs ?? fsPromises;
  let memoryPromise: Promise<string | undefined> | undefined;

  return {
    name: "poe-agent-plugin-memory",
    async prompt(ctx) {
      memoryPromise ??= loadMemory({ cwd, homeDir, fs });
      const memory = await memoryPromise;

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
      assertPathContained(importedFilePath, options.trustedDirectory, "AGENTS.md import");
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
  return importPath.length > 0 ? importPath : undefined;
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
  assertPathContained(canonicalPath, canonicalDirectory, "AGENTS.md file");

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

function assertPathContained(filePath: string, trustedDirectory: string, label: string): void {
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
