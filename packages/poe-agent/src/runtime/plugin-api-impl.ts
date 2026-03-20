import {
  McpClient,
  StdioTransport,
  type CallToolResult,
  type ContentItem,
  type ResourceContents,
  type Tool as McpTool,
} from "tiny-mcp-client";
import { AbortError } from "./hooks.js";
import type { McpServerConfig, PluginApi } from "./plugin-types.js";
import type { Tool } from "./types.js";
import type { RunContext } from "./run-context.js";

const DEFAULT_MCP_CLIENT_INFO = {
  name: "poe-agent",
  version: "0.0.1",
};

type PaginatedTools = {
  tools: McpTool[];
  nextCursor?: string;
};

type McpToolClient = {
  connect(transport: StdioTransport): Promise<unknown>;
  listTools(params?: { cursor?: string }): Promise<PaginatedTools>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ): Promise<CallToolResult>;
  close?(): Promise<void>;
};

export class PluginApiImpl implements PluginApi {
  readonly #runContext: RunContext;
  #setupQueue: Promise<void> = Promise.resolve();

  constructor(runContext: RunContext) {
    this.#runContext = runContext;
  }

  addTool(tool: Tool): void {
    this.#runContext.tools.register(tool);
  }

  addMcp(config: McpServerConfig): void {
    this.#setupQueue = this.#setupQueue.then(() => this.#setupMcp(config));
  }

  async flushSetup(): Promise<void> {
    await this.#setupQueue;
  }

  async #setupMcp(config: McpServerConfig): Promise<void> {
    const transport = new StdioTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });
    const client = new McpClient({
      clientInfo: DEFAULT_MCP_CLIENT_INFO,
      transport,
    } as unknown as ConstructorParameters<typeof McpClient>[0]) as McpToolClient;

    this.#runContext.registerDisposeHook(async () => {
      await client.close?.();
    });
    assertNotAborted(this.#runContext.abortController.signal);
    await client.connect(transport);

    let cursor: string | undefined;

    while (true) {
      assertNotAborted(this.#runContext.abortController.signal);
      const page =
        cursor === undefined ? await client.listTools() : await client.listTools({ cursor });

      for (const tool of page.tools) {
        this.addTool(this.#toRuntimeTool(config, tool, client));
      }

      if (page.nextCursor === undefined) {
        return;
      }

      cursor = page.nextCursor;
    }
  }

  #toRuntimeTool(config: McpServerConfig, mcpTool: McpTool, client: McpToolClient): Tool {
    return {
      name: `${config.name}.${mcpTool.name}`,
      description: mcpTool.description,
      inputSchema: mcpTool.inputSchema,
      visibility: config.visibility ?? "model",
      call: async (args, ctx) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: toMcpArguments(args),
        }, { signal: ctx.signal });

        return callToolResultToString(result);
      },
    };
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  throw new AbortError("Run aborted.", signal.reason);
}

function toMcpArguments(args: unknown): Record<string, unknown> | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }

  return args as Record<string, unknown>;
}

function callToolResultToString(result: CallToolResult): string {
  const content = result.content.map(contentItemToString).join("\n");

  if (result.isError) {
    throw new Error(content);
  }

  return content;
}

function contentItemToString(item: ContentItem): string {
  switch (item.type) {
    case "text":
      return item.text;
    case "image":
      return `[image: ${item.mimeType}]`;
    case "audio":
      return `[audio: ${item.mimeType}]`;
    case "resource":
      return resourceToString(item.resource);
  }
}

function resourceToString(resource: ResourceContents): string {
  if ("text" in resource) {
    return resource.text;
  }

  return `[blob: ${resource.uri}]`;
}
