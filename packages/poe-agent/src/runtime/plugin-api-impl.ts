import {
  McpClient,
  StdioTransport,
  type CallToolResult,
  type ContentItem,
  type ResourceContents,
  type Tool as McpTool
} from "tiny-mcp-client";
import { AbortError } from "./hooks.js";
import { cloneMcpServerConfig } from "./config.js";
import type { McpServerConfig, PluginApi } from "./plugin-types.js";
import { toolResultPartToText } from "./tool-results.js";
import type { Tool, ToolResult, ToolResultPart } from "./types.js";
import type { RunContext } from "./run-context.js";

const DEFAULT_MCP_CLIENT_INFO = {
  name: "poe-agent",
  version: "0.0.1"
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

  getTool(name: string) {
    return this.#runContext.tools.get(name);
  }

  addMcp(config: McpServerConfig): void {
    const clonedConfig = cloneMcpServerConfig(config);
    this.#runContext.mcpServers.push(clonedConfig);
    this.#setupQueue = this.#setupQueue.then(() => this.#setupMcp(clonedConfig));
  }

  async flushSetup(): Promise<void> {
    await this.#setupQueue;
  }

  async #setupMcp(config: McpServerConfig): Promise<void> {
    const transport = new StdioTransport({
      command: config.command,
      args: config.args,
      env:
        config.env === undefined
          ? undefined
          : {
              ...process.env,
              ...config.env
            }
    });
    const client = new McpClient({
      clientInfo: DEFAULT_MCP_CLIENT_INFO
    });

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

  #toRuntimeTool(config: McpServerConfig, mcpTool: McpTool, client: McpClient): Tool {
    return {
      name: `${config.name}.${mcpTool.name}`,
      description: mcpTool.description,
      inputSchema: mcpTool.inputSchema,
      visibility: config.visibility ?? "model",
      policy: {
        read: false,
        edit: true
      },
      call: async (args, ctx) => {
        const result = await client.callTool(
          {
            name: mcpTool.name,
            arguments: toMcpArguments(args)
          },
          { signal: ctx.signal }
        );

        return callToolResultToToolResult(result);
      }
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

function callToolResultToToolResult(result: CallToolResult): ToolResult {
  const content = result.content.map(contentItemToToolResultPart);

  if (result.isError) {
    return {
      type: "error",
      code: "mcp_tool_error",
      message: content.map((part) => toolResultPartToText(part)).join("\n"),
      retriable: false
    };
  }

  if (content.length === 0) {
    return "";
  }

  if (content.length === 1) {
    const [single] = content;
    return single.type === "text" ? single.text : single;
  }

  return content;
}

function contentItemToToolResultPart(item: ContentItem): ToolResultPart {
  switch (item.type) {
    case "text":
      return { type: "text", text: item.text };
    case "image":
      return {
        type: "image",
        mimeType: item.mimeType,
        data: item.data
      };
    case "audio":
      return {
        type: "text",
        text: `[audio: ${item.mimeType}]`
      };
    case "resource":
      return {
        type: "text",
        text: resourceToString(item.resource)
      };
  }
}

function resourceToString(resource: ResourceContents): string {
  if ("text" in resource) {
    return resource.text;
  }

  return `[blob: ${resource.uri}]`;
}
