import fsPromises from "node:fs/promises";
import path from "node:path";
import type { AgentPlugin } from "../runtime/plugin-types.js";

type PluginFileSystem = Pick<typeof fsPromises, "mkdir" | "readFile" | "readdir" | "writeFile">;

type FilesPluginOptions = {
  cwd?: string;
  allowedPaths?: string[];
  fs?: PluginFileSystem;
};

const filesPlugin = (options: FilesPluginOptions = {}): AgentPlugin => {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const allowedPaths = (options.allowedPaths ?? [cwd]).map(allowedPath =>
    path.resolve(cwd, allowedPath),
  );
  const fs = options.fs ?? fsPromises;

  const readFileTool = {
    name: "read_file",
    description: "Read UTF-8 content from a file.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read.",
        },
      },
      required: ["path"],
    },
    async call(args: unknown): Promise<string> {
      const filePath = resolveAllowedPath(cwd, allowedPaths, getRequiredString(args, "path"));
      return fs.readFile(filePath, "utf8");
    },
  };

  const editFileTool = {
    name: "edit_file",
    description:
      "Edit or create files. Use 'str_replace' to replace exact text in an existing file (old_str must appear exactly once). Use 'create' to create a new file (fails if file already exists).",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["str_replace", "create"],
          description: "Operation to perform.",
        },
        path: {
          type: "string",
          description: "File path.",
        },
        old_str: {
          type: "string",
          description: "Exact string to find and replace (str_replace only). Must match exactly once.",
        },
        new_str: {
          type: "string",
          description: "Replacement string (str_replace only).",
        },
        file_text: {
          type: "string",
          description: "Full file content (create only).",
        },
      },
      required: ["command", "path"],
    },
    async call(args: unknown): Promise<string> {
      const command = getRequiredString(args, "command");
      const filePath = resolveAllowedPath(cwd, allowedPaths, getRequiredString(args, "path"));
      const displayedPath = path.relative(cwd, filePath) || path.basename(filePath);

      if (command === "str_replace") {
        const oldStr = getRequiredString(args, "old_str", true);
        const newStr = getRequiredString(args, "new_str", true);
        const content = await fs.readFile(filePath, "utf8");
        const count = countOccurrences(content, oldStr);

        if (count === 0) {
          throw new Error("old_str not found in file");
        }

        if (count > 1) {
          throw new Error(`old_str appears ${count} times — must be unique`);
        }

        await fs.writeFile(filePath, content.replace(oldStr, newStr), "utf8");
        return `Edited file: ${displayedPath}`;
      }

      if (command === "create") {
        const fileText = getRequiredString(args, "file_text", true);

        if (await fileExists(fs, filePath)) {
          throw new Error("File already exists — use str_replace to edit");
        }

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, fileText, "utf8");
        return `Created file: ${displayedPath}`;
      }

      throw new Error(`Unknown edit_file command: ${command}`);
    },
  };

  const listFilesTool = {
    name: "list_files",
    description: "List files in a directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list. Defaults to current working directory.",
        },
      },
    },
    async call(args: unknown): Promise<string> {
      const rawPath = getOptionalString(args, "path") ?? ".";
      const directoryPath = resolveAllowedPath(cwd, allowedPaths, rawPath);
      const entries = await fs.readdir(directoryPath);
      const names = entries.sort((left, right) => left.localeCompare(right));

      if (names.length === 0) {
        return "(empty directory)";
      }

      return names.join("\n");
    },
  };

  return {
    name: "poe-agent-plugin-files",
    tools: [readFileTool, editFileTool, listFilesTool],
  };
};

function resolveAllowedPath(cwd: string, allowedPaths: string[], inputPath: string): string {
  const resolvedPath = path.resolve(cwd, inputPath);
  const isAllowed = allowedPaths.some(allowedPath => {
    if (allowedPath === resolvedPath) {
      return true;
    }

    const rel = path.relative(allowedPath, resolvedPath);
    return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
  });

  if (!isAllowed) {
    throw new Error(`Path is outside allowed paths: ${inputPath}`);
  }

  return resolvedPath;
}

async function fileExists(fs: PluginFileSystem, filePath: string): Promise<boolean> {
  try {
    await fs.readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function getRequiredString(args: unknown, key: string, allowEmptyString = false): string {
  if (!isObjectRecord(args)) {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  const value = args[key];

  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  if (!allowEmptyString && value.trim().length === 0) {
    throw new Error(`Tool argument "${key}" must not be empty`);
  }

  return value;
}

function getOptionalString(args: unknown, key: string): string | undefined {
  if (!isObjectRecord(args)) {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  return value;
}

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let index = 0;

  while ((index = text.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }

  return count;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default filesPlugin;
