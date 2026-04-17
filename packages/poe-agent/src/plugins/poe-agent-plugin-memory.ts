import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentPlugin } from "../runtime/plugin-types.js";

const AGENTS_FILE = "AGENTS.md";
const USER_MEMORY_DIRECTORY = path.join(".config", "poe-code");

type MemoryPluginFileSystem = Pick<typeof fsPromises, "readFile">;

export type MemoryPluginOptions = {
  cwd?: string;
  homeDir?: string;
  fs?: MemoryPluginFileSystem;
};

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
    const projectMemory = await loadOptionalMemoryFile(projectMemoryPath, options.fs);
    if (projectMemory) {
      sections.push(formatMemorySection("Project memory", projectMemory));
    }
  }

  const userMemory = await loadOptionalMemoryFile(
    path.join(options.homeDir, USER_MEMORY_DIRECTORY, AGENTS_FILE),
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
    if ((await readOptionalFile(filePath, fs)) !== undefined) {
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
  fs: MemoryPluginFileSystem,
): Promise<string | undefined> {
  const content = await readOptionalFile(filePath, fs);
  if (content === undefined) {
    return undefined;
  }

  return await expandImports({
    filePath,
    content,
    fs,
    loading: new Set<string>(),
  });
}

async function expandImports(options: {
  filePath: string;
  content: string;
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
      const importedContent = await readRequiredFile(importedFilePath, options.fs);
      const expandedImport = await expandImports({
        filePath: importedFilePath,
        content: importedContent,
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

async function readOptionalFile(
  filePath: string,
  fs: MemoryPluginFileSystem,
): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readRequiredFile(filePath: string, fs: MemoryPluginFileSystem): Promise<string> {
  const content = await readOptionalFile(filePath, fs);
  if (content !== undefined) {
    return content;
  }

  throw new Error(`Missing AGENTS.md import: ${filePath}`);
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export default memoryPlugin;
