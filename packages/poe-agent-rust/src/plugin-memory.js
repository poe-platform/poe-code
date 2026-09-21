import { native } from "./native.js";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import { readOptionalString, rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
const AGENTS_FILE = "AGENTS.md";
const USER_MEMORY_DIRECTORY = path.join(".config", "poe-code");
const memoryPlugin = (options = {}) => {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const fs = options.fs ?? fsPromises;
  let memoryPromise;
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
        system: [memory, ctx.system].filter(Boolean).join("\n\n")
      };
    }
  };
};
async function loadMemory(options) {
  const sections = [];
  const projectMemoryPath = await findNearestAgentsFile(options.cwd, options.fs);
  if (projectMemoryPath) {
    const projectMemory = await loadOptionalMemoryFile(
      projectMemoryPath,
      path.dirname(projectMemoryPath),
      options.fs
    );
    if (projectMemory) {
      sections.push(formatMemorySection("Project memory", projectMemory));
    }
  }
  const userMemory = await loadOptionalMemoryFile(
    path.join(options.homeDir, USER_MEMORY_DIRECTORY, AGENTS_FILE),
    path.join(options.homeDir, USER_MEMORY_DIRECTORY),
    options.fs
  );
  if (userMemory) {
    sections.push(formatMemorySection("User memory", userMemory));
  }
  if (sections.length === 0) {
    return undefined;
  }
  return sections.join("\n\n");
}
async function findNearestAgentsFile(cwd, fs) {
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
async function loadOptionalMemoryFile(filePath, trustedDirectory, fs) {
  const content = await readOptionalTrustedFile(filePath, trustedDirectory, fs);
  if (content === undefined) {
    return undefined;
  }
  return await expandImports({
    filePath,
    content,
    trustedDirectory,
    fs,
    loading: new native.NativeAgentMemoryLoading()
  });
}
async function expandImports(options) {
  const normalizedPath = path.resolve(options.filePath);
  if (!options.loading.enter(normalizedPath)) {
    throw new Error(`Circular AGENTS.md import detected: ${normalizedPath}`);
  }

  try {
    const expandedLines = [];
    for (const line of native.agentMemoryLines(options.content)) {
      const importPath = native.agentMemoryImport(line);
      if (!importPath) {
        expandedLines.push(line);
        continue;
      }
      const importedFilePath = path.resolve(path.dirname(normalizedPath), importPath);
      assertPathContained(importedFilePath, options.trustedDirectory, "AGENTS.md import");
      const importedContent = await readRequiredTrustedFile(
        importedFilePath,
        options.trustedDirectory,
        options.fs
      );
      const expandedImport = await expandImports({
        filePath: importedFilePath,
        content: importedContent,
        trustedDirectory: options.trustedDirectory,
        fs: options.fs,
        loading: options.loading
      });
      if (expandedImport) {
        expandedLines.push(expandedImport);
      }
    }
    const expandedContent = expandedLines.join("\n").trim();
    return expandedContent.length > 0 ? expandedContent : undefined;
  } finally {
    options.loading.leave(normalizedPath);
  }
}
function formatMemorySection(title, content) {
  return `${title}:\n${content}`;
}
async function readOptionalTrustedFile(filePath, trustedDirectory, fs) {
  if (!(await exists(filePath, fs))) {
    return undefined;
  }
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`AGENTS.md file escapes its trusted directory: ${filePath}`);
  }
  const [canonicalPath, canonicalDirectory] = await Promise.all([
    fs.realpath(filePath),
    fs.realpath(trustedDirectory)
  ]);
  assertPathContained(canonicalPath, canonicalDirectory, "AGENTS.md file");
  return await fs.readFile(filePath, "utf8");
}
async function readRequiredTrustedFile(filePath, trustedDirectory, fs) {
  const content = await readOptionalTrustedFile(filePath, trustedDirectory, fs);
  if (content !== undefined) {
    return content;
  }
  throw new Error(`Missing AGENTS.md import: ${filePath}`);
}
async function exists(filePath, fs) {
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
function assertPathContained(filePath, trustedDirectory, label) {
  const relativePath = path.relative(trustedDirectory, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes its trusted directory: ${filePath}`);
  }
}
function isMissingFileError(error) {
  return hasOwnErrorCode(error, "ENOENT");
}
export default memoryPlugin;
export const spec = {
  name: "memory",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["cwd", "homeDir"]);
    const options = {};
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
  factory: (options) => memoryPlugin(options)
};
