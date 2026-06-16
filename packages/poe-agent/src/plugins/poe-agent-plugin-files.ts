import { execFile as execFileCallback } from "node:child_process";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import fastGlob from "fast-glob";
import { hasOwnErrorCode } from "../error-codes.js";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import {
  readOptionalString,
  readOptionalStringArray,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import {
  getOptionalBoolean,
  getOptionalNonNegativeInteger,
  getOptionalString,
  getRequiredString,
  isObjectRecord,
  assertNoSymbolicLinkPath,
  assertAllowedPathEntries,
  normalizeAllowedPaths,
  resolveAllowedPath
} from "./plugin-args.js";
import type { PluginSpec } from "./registry.js";

type PluginFileSystem = Pick<
  typeof fsPromises,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "stat" | "unlink" | "writeFile"
>;

type GrepOutputMode = "files_with_matches" | "content" | "count";

type SearchContentOptions = {
  pattern: string;
  path: string;
  glob?: string;
  outputMode: GrepOutputMode;
  lineNumbers: boolean;
  ignoreCase: boolean;
  signal: AbortSignal;
};

type SearchContentFn = (options: SearchContentOptions) => Promise<string>;

type GlobFilesOptions = {
  pattern: string;
  cwd: string;
};

type GlobFilesFn = (options: GlobFilesOptions) => Promise<string[]>;

type FilesPluginOptions = {
  cwd?: string;
  allowedPaths?: string[];
  fs?: PluginFileSystem;
  searchContent?: SearchContentFn;
  globFiles?: GlobFilesFn;
};

export type FilesPluginConfigOptions = Pick<FilesPluginOptions, "cwd" | "allowedPaths">;

const execFile = promisify(execFileCallback);

const filesPlugin = (options: FilesPluginOptions = {}): AgentPlugin => {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const allowedPaths = normalizeAllowedPaths(cwd, options.allowedPaths);
  const fs = options.fs ?? fsPromises;
  const searchContent =
    options.searchContent ?? ((searchOptions) => defaultSearchContent(searchOptions, fs));
  const globFiles = options.globFiles ?? defaultGlobFiles;

  const readFileTool = {
    name: "read_file",
    description: "Read UTF-8 content from a file.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read."
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Zero-based starting line offset."
        },
        limit: {
          type: "integer",
          minimum: 0,
          description: "Maximum number of lines to read."
        }
      },
      required: ["path"]
    },
    async call(args: unknown) {
      const filePath = resolveAllowedPath(cwd, allowedPaths, getRequiredString(args, "path"));
      await assertNoSymbolicLinkPath(fs, filePath);
      const imageMimeType = detectImageMimeType(filePath);
      if (imageMimeType !== undefined) {
        const content = await fs.readFile(filePath);
        return {
          type: "image" as const,
          mimeType: imageMimeType,
          data: Buffer.from(content).toString("base64")
        };
      }

      const content = await fs.readFile(filePath, "utf8");
      return sliceLines(
        content,
        getOptionalNonNegativeInteger(args, "offset") ?? 0,
        getOptionalNonNegativeInteger(args, "limit")
      );
    }
  };

  const editFileTool = {
    name: "edit_file",
    description:
      "Edit or create files. 'str_replace' replaces exact text (old_str must be unique unless replace_all is true). 'create' writes a new file and fails if it exists. 'overwrite' replaces file contents, creating the file if missing.",
    policy: {
      read: false,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["str_replace", "create", "overwrite"],
          description: "Operation to perform."
        },
        path: {
          type: "string",
          description: "File path."
        },
        old_str: {
          type: "string",
          description:
            "Exact string to find and replace (str_replace only). Must match exactly once."
        },
        new_str: {
          type: "string",
          description: "Replacement string (str_replace only)."
        },
        replace_all: {
          type: "boolean",
          description: "Replace all matching occurrences instead of requiring exactly one match."
        },
        file_text: {
          type: "string",
          description: "Full file content (create and overwrite only)."
        }
      },
      required: ["command", "path"]
    },
    async call(args: unknown): Promise<string> {
      const command = getRequiredString(args, "command");
      const filePath = resolveAllowedPath(cwd, allowedPaths, getRequiredString(args, "path"));
      const displayedPath = formatDisplayPath(cwd, filePath);
      await assertNoSymbolicLinkPath(fs, filePath);

      if (command === "str_replace") {
        const oldStr = getRequiredString(args, "old_str", true);
        const newStr = getRequiredString(args, "new_str", true);
        const replaceAll = getOptionalBoolean(args, "replace_all") ?? false;
        const content = await fs.readFile(filePath, "utf8");

        if (oldStr.length === 0) {
          throw new Error('Tool argument "old_str" must not be empty');
        }

        const count = countOccurrences(content, oldStr);

        if (count === 0) {
          throw new Error("old_str not found in file");
        }

        if (!replaceAll && count > 1) {
          throw new Error(`old_str appears ${count} times — must be unique`);
        }

        await replaceFileAtomically(
          fs,
          filePath,
          replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr)
        );
        return `Edited file: ${displayedPath}`;
      }

      if (command === "create") {
        const fileText = getRequiredString(args, "file_text", true);

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await assertNoSymbolicLinkPath(fs, filePath);
        try {
          await fs.writeFile(filePath, fileText, { encoding: "utf8", flag: "wx" });
        } catch (error) {
          if (isAlreadyExistsError(error)) {
            throw new Error("File already exists — use str_replace to edit");
          }
          await fs.unlink(filePath).catch(() => undefined);
          throw error;
        }
        return `Created file: ${displayedPath}`;
      }

      if (command === "overwrite") {
        const fileText = getRequiredString(args, "file_text", true);

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await assertNoSymbolicLinkPath(fs, filePath);
        await replaceFileAtomically(fs, filePath, fileText);
        return `Overwrote file: ${displayedPath}`;
      }

      throw new Error(`Unknown edit_file command: ${command}`);
    }
  };

  const listFilesTool = {
    name: "list_files",
    description: "List files in a directory.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list. Defaults to current working directory."
        }
      }
    },
    async call(args: unknown): Promise<string> {
      const rawPath = getOptionalString(args, "path") ?? ".";
      const directoryPath = resolveAllowedPath(cwd, allowedPaths, rawPath);
      await assertNoSymbolicLinkPath(fs, directoryPath);
      const entries = await fs.readdir(directoryPath);
      const names = entries.sort((left, right) => left.localeCompare(right));

      if (names.length === 0) {
        return "(empty directory)";
      }

      return names.join("\n");
    }
  };

  const grepTool = {
    name: "grep",
    description: "Search file contents with ripgrep.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Pattern to search for."
        },
        path: {
          type: "string",
          description:
            "Directory or file path to search. Defaults to the current working directory."
        },
        glob: {
          type: "string",
          description: "Optional glob filter passed to ripgrep."
        },
        output_mode: {
          type: "string",
          enum: ["files_with_matches", "content", "count"],
          description: "Whether to return matching files, matching content, or a total count."
        },
        line_numbers: {
          type: "boolean",
          description: "Include line numbers in content output."
        },
        ignore_case: {
          type: "boolean",
          description: "Case-insensitive search."
        }
      },
      required: ["pattern"]
    },
    async call(args: unknown, ctx: { signal: AbortSignal }): Promise<string> {
      const searchPath = resolveAllowedPath(
        cwd,
        allowedPaths,
        getOptionalString(args, "path") ?? "."
      );
      await assertNoSymbolicLinkPath(fs, searchPath);

      return searchContent({
        pattern: getRequiredString(args, "pattern"),
        path: searchPath,
        glob: getOptionalString(args, "glob"),
        outputMode: getOptionalGrepOutputMode(args, "output_mode") ?? "content",
        lineNumbers: getOptionalBoolean(args, "line_numbers") ?? false,
        ignoreCase: getOptionalBoolean(args, "ignore_case") ?? false,
        signal: ctx.signal
      });
    }
  };

  const globTool = {
    name: "glob",
    description: "Find files by glob pattern, sorted by most recently modified first.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Fast-glob pattern to match."
        },
        path: {
          type: "string",
          description: "Directory to search from. Defaults to the current working directory."
        }
      },
      required: ["pattern"]
    },
    async call(args: unknown): Promise<string> {
      const searchPath = resolveAllowedPath(
        cwd,
        allowedPaths,
        getOptionalString(args, "path") ?? "."
      );
      await assertNoSymbolicLinkPath(fs, searchPath);
      const matches = await globFiles({
        pattern: getRequiredString(args, "pattern"),
        cwd: searchPath
      });

      const resolvedMatches = await Promise.all(
        matches.map(async (match) => {
          const resolvedMatch = resolveAllowedPath(cwd, allowedPaths, match);
          await assertNoSymbolicLinkPath(fs, resolvedMatch);
          return resolvedMatch;
        })
      );
      const sortedMatches = await sortPathsByModifiedTime(resolvedMatches, fs);

      if (sortedMatches.length === 0) {
        return "(no matches)";
      }

      return sortedMatches.map((match) => formatDisplayPath(cwd, match)).join("\n");
    }
  };

  return {
    name: "poe-agent-plugin-files",
    tools: [readFileTool, editFileTool, listFilesTool, grepTool, globTool]
  };
};

async function replaceFileAtomically(
  fs: PluginFileSystem,
  filePath: string,
  content: string
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  );
  let temporaryCreated = false;

  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    temporaryCreated = true;
    await fs.rename(temporaryPath, filePath);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated || !isAlreadyExistsError(error)) {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function countOccurrences(text: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while ((index = text.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }

  return count;
}

function getOptionalGrepOutputMode(args: unknown, key: string): GrepOutputMode | undefined {
  if (!isObjectRecord(args)) {
    throw new Error(
      `Tool argument "${key}" must be one of "files_with_matches", "content", or "count"`
    );
  }

  const value = args[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === "files_with_matches" || value === "content" || value === "count") {
    return value;
  }

  throw new Error(
    `Tool argument "${key}" must be one of "files_with_matches", "content", or "count"`
  );
}

function formatDisplayPath(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath) || path.basename(filePath);
}

async function sortPathsByModifiedTime(
  matches: string[],
  fs: Pick<typeof fsPromises, "stat">
): Promise<string[]> {
  const entries = await Promise.all(
    matches.map(async (match) => ({
      path: match,
      mtimeMs: (await fs.stat(match)).mtimeMs
    }))
  );

  entries.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }

    return left.path.localeCompare(right.path);
  });

  return entries.map((entry) => entry.path);
}

async function defaultSearchContent(
  options: SearchContentOptions,
  fs: Pick<typeof fsPromises, "stat">
): Promise<string> {
  const targetStat = await fs.stat(options.path);
  const searchCwd = targetStat.isDirectory() ? options.path : path.dirname(options.path);
  const searchTarget = targetStat.isDirectory() ? "." : path.basename(options.path);
  const args = ["--color", "never"];

  if (options.outputMode === "content") {
    args.push("--with-filename");
    if (options.lineNumbers) {
      args.push("-n");
    }
  } else if (options.outputMode === "files_with_matches") {
    args.push("--files-with-matches");
  } else {
    args.push("--count", "--no-filename");
  }

  if (options.ignoreCase) {
    args.push("-i");
  }

  if (options.glob !== undefined) {
    args.push("--glob", options.glob);
  }

  args.push(options.pattern, searchTarget);

  try {
    const result = await execFile("rg", args, {
      cwd: searchCwd,
      maxBuffer: 1024 * 1024,
      signal: options.signal
    });

    return formatGrepOutput(result.stdout, options.outputMode);
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === 1) {
      return options.outputMode === "count" ? "0" : "(no matches)";
    }

    if (error instanceof Error) {
      const stderr = Reflect.get(error, "stderr");
      if (typeof stderr === "string" && stderr.trim().length > 0) {
        throw new Error(`grep failed: ${stderr.trim()}`);
      }

      throw new Error(`grep failed: ${error.message}`);
    }

    throw new Error(`grep failed: ${String(error)}`);
  }
}

function formatGrepOutput(stdout: string, outputMode: GrepOutputMode): string {
  const trimmed = stdout.trimEnd();

  if (trimmed.length === 0) {
    return outputMode === "count" ? "0" : "(no matches)";
  }

  if (outputMode !== "count") {
    return trimmed;
  }

  let count = 0;
  for (const line of trimmed.split("\n")) {
    const parsed = Number(line);
    if (Number.isNaN(parsed)) {
      return trimmed;
    }

    count += parsed;
  }

  return String(count);
}

async function defaultGlobFiles(options: GlobFilesOptions): Promise<string[]> {
  return fastGlob(options.pattern, {
    absolute: true,
    cwd: options.cwd,
    dot: true,
    onlyFiles: true,
    unique: true
  });
}

function sliceLines(content: string, offset: number, limit: number | undefined): string {
  if (offset === 0 && limit === undefined) {
    return content;
  }

  if (limit === 0) {
    return "";
  }

  let lineStart = 0;

  for (let currentLine = 0; currentLine < offset; currentLine += 1) {
    const nextNewline = content.indexOf("\n", lineStart);
    if (nextNewline === -1) {
      return "";
    }

    lineStart = nextNewline + 1;
  }

  if (limit === undefined) {
    return content.slice(lineStart);
  }

  let lineEnd = lineStart;

  for (let remaining = 0; remaining < limit; remaining += 1) {
    const nextNewline = content.indexOf("\n", lineEnd);
    if (nextNewline === -1) {
      return content.slice(lineStart);
    }

    lineEnd = nextNewline + 1;
  }

  return content.slice(lineStart, lineEnd);
}

function detectImageMimeType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".bmp") {
    return "image/bmp";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  return undefined;
}

export default filesPlugin;

export const spec: PluginSpec<FilesPluginConfigOptions> = {
  name: "files",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["cwd", "allowedPaths"]);
    const options: FilesPluginConfigOptions = {};
    const cwd = readOptionalString(obj, "cwd");
    if (cwd !== undefined) {
      options.cwd = cwd;
    }
    const allowedPaths = readOptionalStringArray(obj, "allowedPaths");
    if (allowedPaths !== undefined) {
      assertAllowedPathEntries(allowedPaths);
      options.allowedPaths = allowedPaths;
    }
    return options;
  },
  factory: options => filesPlugin(options),
};
