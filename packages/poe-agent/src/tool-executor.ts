import { exec as execCallback } from "node:child_process";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolExecutor } from "./chat.js";

const exec = promisify(execCallback);

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ToolExecutorFileSystem = Pick<
  typeof fsPromises,
  "mkdir" | "readFile" | "readdir" | "writeFile"
>;

export type RunCommandFn = (command: string, cwd: string) => Promise<string>;

export type SearchWebFn = (query: string) => Promise<string>;

export interface DefaultToolExecutorOptions {
  cwd?: string;
  allowedPaths?: string[];
  fs?: ToolExecutorFileSystem;
  runCommand?: RunCommandFn;
  searchWeb?: SearchWebFn;
  fetch?: FetchFn;
}

interface DuckDuckGoTopic {
  Text?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoPayload {
  AbstractText?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

export class DefaultToolExecutor implements ToolExecutor {
  private readonly cwd: string;
  private readonly allowedPaths: string[];
  private readonly fs: ToolExecutorFileSystem;
  private readonly runCommandFn: RunCommandFn;
  private readonly searchWebFn: SearchWebFn;

  constructor(options: DefaultToolExecutorOptions = {}) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.allowedPaths = (options.allowedPaths ?? [this.cwd]).map(allowedPath =>
      path.resolve(this.cwd, allowedPath),
    );
    this.fs = options.fs ?? fsPromises;
    this.runCommandFn = options.runCommand ?? defaultRunCommand;

    const fetchFn = options.fetch ?? globalThis.fetch;
    this.searchWebFn = options.searchWeb ?? (query => defaultSearchWeb(query, fetchFn));
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "read_file":
        return this.executeReadFile(args);
      case "edit_file":
        return this.executeEditFile(args);
      case "list_files":
        return this.executeListFiles(args);
      case "run_command":
        return this.executeRunCommand(args);
      case "search_web":
        return this.executeSearchWeb(args);
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }

  getAvailableTools(): Tool[] {
    return [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read UTF-8 content from a file.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the file to read.",
              },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "edit_file",
          description:
            "Edit or create files. Use 'str_replace' to replace exact text in an existing file (old_str must appear exactly once). Use 'create' to create a new file (fails if file already exists).",
          parameters: {
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
        },
      },
      {
        type: "function",
        function: {
          name: "list_files",
          description: "List files in a directory.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Directory path to list. Defaults to current working directory.",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "run_command",
          description: "Run a shell command.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "Command to execute.",
              },
              cwd: {
                type: "string",
                description: "Working directory for command execution.",
              },
            },
            required: ["command"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_web",
          description: "Search the web for a query.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query.",
              },
            },
            required: ["query"],
          },
        },
      },
    ];
  }

  private async executeReadFile(args: Record<string, unknown>): Promise<string> {
    const filePath = this.resolveAllowedPath(getRequiredString(args, "path"));
    return this.fs.readFile(filePath, "utf8");
  }

  private async executeEditFile(args: Record<string, unknown>): Promise<string> {
    const command = getRequiredString(args, "command");
    const filePath = this.resolveAllowedPath(getRequiredString(args, "path"));
    const displayedPath = path.relative(this.cwd, filePath) || path.basename(filePath);

    if (command === "str_replace") {
      const oldStr = getRequiredString(args, "old_str", true);
      const newStr = getRequiredString(args, "new_str", true);
      const content = await this.fs.readFile(filePath, "utf8");
      const count = countOccurrences(content, oldStr);

      if (count === 0) {
        throw new Error("old_str not found in file");
      }

      if (count > 1) {
        throw new Error(`old_str appears ${count} times — must be unique`);
      }

      await this.fs.writeFile(filePath, content.replace(oldStr, newStr), "utf8");
      return `Edited file: ${displayedPath}`;
    }

    if (command === "create") {
      const fileText = getRequiredString(args, "file_text", true);

      if (await this.fileExists(filePath)) {
        throw new Error("File already exists — use str_replace to edit");
      }

      await this.fs.mkdir(path.dirname(filePath), { recursive: true });
      await this.fs.writeFile(filePath, fileText, "utf8");
      return `Created file: ${displayedPath}`;
    }

    throw new Error(`Unknown edit_file command: ${command}`);
  }

  private async executeListFiles(args: Record<string, unknown>): Promise<string> {
    const rawPath = getOptionalString(args, "path") ?? ".";
    const directoryPath = this.resolveAllowedPath(rawPath);
    const entries = await this.fs.readdir(directoryPath);
    const names = entries.sort((left, right) => left.localeCompare(right));

    if (names.length === 0) {
      return "(empty directory)";
    }

    return names.join("\n");
  }

  private async executeRunCommand(args: Record<string, unknown>): Promise<string> {
    const command = getRequiredString(args, "command");
    const commandCwdArg = getOptionalString(args, "cwd");
    const commandCwd = commandCwdArg ? this.resolveAllowedPath(commandCwdArg) : this.cwd;

    return this.runCommandFn(command, commandCwd);
  }

  private async executeSearchWeb(args: Record<string, unknown>): Promise<string> {
    const query = getRequiredString(args, "query");
    return this.searchWebFn(query);
  }

  private resolveAllowedPath(inputPath: string): string {
    const resolvedPath = path.resolve(this.cwd, inputPath);
    const isAllowed = this.allowedPaths.some(allowedPath => {
      if (allowedPath === resolvedPath) return true;
      const rel = path.relative(allowedPath, resolvedPath);
      return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
    });

    if (!isAllowed) {
      throw new Error(`Path is outside allowed paths: ${inputPath}`);
    }

    return resolvedPath;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await this.fs.readFile(filePath, "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

function getRequiredString(
  args: Record<string, unknown>,
  key: string,
  allowEmptyString = false,
): string {
  const value = args[key];

  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }

  if (!allowEmptyString && value.trim().length === 0) {
    throw new Error(`Tool argument "${key}" must not be empty`);
  }

  return value;
}

function getOptionalString(args: Record<string, unknown>, key: string): string | undefined {
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
    count++;
    index += search.length;
  }
  return count;
}

async function defaultRunCommand(command: string, cwd: string): Promise<string> {
  try {
    const result = await exec(command, {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });

    const combinedOutput = [result.stdout, result.stderr]
      .map(output => output.trim())
      .filter(output => output.length > 0)
      .join("\n");

    return combinedOutput || "Command completed with no output";
  } catch (error) {
    if (error instanceof Error) {
      const stderr = Reflect.get(error, "stderr");
      if (typeof stderr === "string" && stderr.trim().length > 0) {
        throw new Error(`Command failed: ${stderr.trim()}`);
      }

      const stdout = Reflect.get(error, "stdout");
      if (typeof stdout === "string" && stdout.trim().length > 0) {
        throw new Error(`Command failed: ${stdout.trim()}`);
      }

      throw new Error(`Command failed: ${error.message}`);
    }

    throw new Error(`Command failed: ${String(error)}`);
  }
}

async function defaultSearchWeb(query: string, fetchFn: FetchFn): Promise<string> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetchFn(url.toString());
  if (!response.ok) {
    throw new Error(`Web search failed (${response.status})`);
  }

  const body = (await response.json()) as DuckDuckGoPayload;
  const lines: string[] = [];

  if (typeof body.AbstractText === "string" && body.AbstractText.trim().length > 0) {
    lines.push(body.AbstractText.trim());
  }

  if (body.RelatedTopics) {
    const queue = [...body.RelatedTopics];
    while (queue.length > 0 && lines.length < 5) {
      const current = queue.shift();
      if (!current) continue;

      if (typeof current.Text === "string" && current.Text.trim().length > 0) {
        lines.push(current.Text.trim());
      }

      if (current.Topics) {
        queue.push(...current.Topics);
      }
    }
  }

  if (lines.length === 0) {
    return "No search results found.";
  }

  return lines.join("\n");
}
