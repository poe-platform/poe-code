import fsPromises from "node:fs/promises";
import type { Tool as ChatTool, ToolExecutor } from "./chat.js";
import type { Tool as RuntimeTool, ToolContext } from "./runtime/types.js";
import filesPlugin from "./plugins/poe-agent-plugin-files.js";
import shellPlugin from "./plugins/poe-agent-plugin-shell.js";
import webPlugin from "./plugins/poe-agent-plugin-web.js";

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

export class DefaultToolExecutor implements ToolExecutor {
  readonly #tools = new Map<string, RuntimeTool>();
  readonly #runtimeTools: RuntimeTool[];
  readonly #toolContext: ToolContext = {
    fork: async () => {
      throw new Error("fork is not supported by DefaultToolExecutor");
    },
    spawn: async () => {
      throw new Error("spawn is not supported by DefaultToolExecutor");
    },
    signal: new AbortController().signal,
  };

  constructor(options: DefaultToolExecutorOptions = {}) {
    this.#runtimeTools = [
      ...(filesPlugin({
        cwd: options.cwd,
        allowedPaths: options.allowedPaths,
        fs: options.fs,
      }).tools ?? []),
      ...(shellPlugin({
        cwd: options.cwd,
        allowedPaths: options.allowedPaths,
        runCommand: options.runCommand,
      }).tools ?? []),
      ...(webPlugin({
        searchWeb: options.searchWeb,
        fetch: options.fetch,
      }).tools ?? []),
    ];

    for (const tool of this.#runtimeTools) {
      this.#tools.set(tool.name, tool);
    }
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new Error(`Unsupported tool: ${name}`);
    }

    const result = await invokeTool(tool, args, this.#toolContext);
    return typeof result === "string" ? result : String(result);
  }

  getAvailableTools(): ChatTool[] {
    return this.#runtimeTools.map(runtimeToolToChatTool);
  }
}

async function invokeTool(
  tool: RuntimeTool,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<unknown> {
  const result = tool.call(args, context);

  if (!isAsyncGenerator(result)) {
    return await result;
  }

  while (true) {
    const next = await result.next();
    if (next.done) {
      return next.value;
    }
  }
}

function runtimeToolToChatTool(tool: RuntimeTool): ChatTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: normalizeToolInputSchema(tool.inputSchema),
    },
  };
}

function normalizeToolInputSchema(inputSchema: unknown): ChatTool["function"]["parameters"] {
  if (!isObjectRecord(inputSchema)) {
    return {
      type: "object",
      properties: {},
    };
  }

  const properties = isObjectRecord(inputSchema.properties) ? inputSchema.properties : {};
  const normalized: ChatTool["function"]["parameters"] = {
    type: "object",
    properties,
  };

  if (
    Array.isArray(inputSchema.required) &&
    inputSchema.required.every(value => typeof value === "string")
  ) {
    normalized.required = [...inputSchema.required];
  }

  return normalized;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, void> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<AsyncGenerator<unknown, unknown, void>>;
  return (
    typeof candidate.next === "function" &&
    typeof candidate.return === "function" &&
    typeof candidate.throw === "function" &&
    typeof candidate[Symbol.asyncIterator] === "function"
  );
}
