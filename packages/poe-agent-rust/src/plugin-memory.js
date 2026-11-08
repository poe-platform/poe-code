import { getNodeFsBridgeProvider } from "@poe-code/safe-fs";
import { resolvePluginFileSystem } from "@poe-code/poe-agent";
import { native } from "./native.js";
import fsPromises from "node:fs/promises";
import os from "node:os";
import nativePath from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import { readOptionalString, rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
const AGENTS_FILE = "AGENTS.md";
const USER_MEMORY_DIRECTORY = ".config/poe-code";
const memoryPlugin = (options = {}) => {
  const memories = new WeakMap();
  return {
    name: "poe-agent-plugin-memory",
    setup(api) { resolvePluginFileSystem(api.runtime, options.fs, fsPromises); },
    async prompt(ctx, runtime) {
      const fs = resolvePluginFileSystem(runtime, options.fs, fsPromises);
      const path = getNodeFsBridgeProvider(fs) ? nativePath.posix : nativePath;
      const cwd = path.resolve(runtime?.cwd ?? options.cwd ?? process.cwd(), options.cwd ?? ".");
      const homeDir = path.resolve(runtime?.homeDir ?? options.homeDir ?? os.homedir(), options.homeDir ?? ".");
      let pending = runtime ? memories.get(runtime) : undefined;
      if (!pending) { pending = loadMemory({ cwd, homeDir, fs }); if (runtime) memories.set(runtime, pending); }
      const memory = await pending;
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
  const path = getNodeFsBridgeProvider(options.fs) ? nativePath.posix : nativePath;
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
  const path = getNodeFsBridgeProvider(options.fs) ? nativePath.posix : nativePath;
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
      assertPathContained(importedFilePath, options.trustedDirectory, "AGENTS.md import", path);
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
  assertPathContained(canonicalPath, canonicalDirectory, "AGENTS.md file", getNodeFsBridgeProvider(fs) ? nativePath.posix : nativePath);
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
function assertPathContained(filePath, trustedDirectory, label, path = nativePath) {
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
