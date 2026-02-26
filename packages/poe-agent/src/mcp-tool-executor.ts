import type { CallToolResult, ContentItem, ResourceContents, Tool as McpTool } from "tiny-mcp-client";
import type { Tool } from "./chat.js";

export interface McpStdioServerDefinition {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerDefinition {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerDefinition = McpStdioServerDefinition | McpHttpServerDefinition;

interface McpListToolsResult {
  tools: McpTool[];
  nextCursor?: string;
}

interface McpPaginatedParams {
  cursor?: string;
}

interface McpToolClient {
  listTools(params?: McpPaginatedParams): Promise<McpListToolsResult>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<CallToolResult>;
  close?(): Promise<void>;
}

interface ToolClientRegistration {
  client: McpToolClient;
  originalName: string;
}

export function namespaceMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

export class McpToolExecutor {
  private readonly discoveredTools: Tool[] = [];
  private readonly toolToClient = new Map<string, ToolClientRegistration>();
  private readonly clients = new Set<McpToolClient>();
  private disposed = false;

  async addServer(serverName: string, client: McpToolClient): Promise<void> {
    this.clients.add(client);
    let nextCursor: string | undefined;

    while (true) {
      const page =
        nextCursor === undefined
          ? await client.listTools()
          : await client.listTools({ cursor: nextCursor });

      for (const mcpTool of page.tools) {
        const openAiTool = mcpToolToOpenAiTool(serverName, mcpTool);
        this.discoveredTools.push(openAiTool);
        this.toolToClient.set(openAiTool.function.name, {
          client,
          originalName: mcpTool.name,
        });
      }

      if (page.nextCursor === undefined) {
        return;
      }

      nextCursor = page.nextCursor;
    }
  }

  getAvailableTools(): Tool[] {
    return [...this.discoveredTools];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (this.disposed) {
      throw new Error("MCP tool executor is disposed");
    }

    const registration = this.toolToClient.get(name);
    if (!registration) {
      throw new Error(`MCP tool not found: ${name}`);
    }

    const result = await registration.client.callTool({
      name: registration.originalName,
      arguments: args,
    });

    return callToolResultToString(result);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const closeOperations: Promise<void>[] = [];

    for (const client of this.clients) {
      if (client.close === undefined) {
        continue;
      }

      closeOperations.push(client.close());
    }

    await Promise.allSettled(closeOperations);
    this.clients.clear();
  }
}

export function mcpToolToOpenAiTool(serverName: string, mcpTool: McpTool): Tool {
  const parameters: Tool["function"]["parameters"] = {
    type: "object",
    properties: getInputSchemaProperties(mcpTool.inputSchema),
  };
  const required = getInputSchemaRequired(mcpTool.inputSchema);

  if (required) {
    parameters.required = required;
  }

  return {
    type: "function",
    function: {
      name: namespaceMcpToolName(serverName, mcpTool.name),
      description: mcpTool.description ?? "",
      parameters,
    },
  };
}

export function callToolResultToString(result: CallToolResult): string {
  const content = result.content.map(contentItemToString).join("\n");

  if (result.isError) {
    throw new Error(content);
  }

  return content;
}

function getInputSchemaProperties(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const properties = inputSchema.properties;
  return isObjectRecord(properties) ? properties : {};
}

function getInputSchemaRequired(inputSchema: Record<string, unknown>): string[] | undefined {
  const required = inputSchema.required;

  if (!Array.isArray(required) || required.some(value => typeof value !== "string")) {
    return undefined;
  }

  return required;
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
      return resourceContentsToString(item.resource);
  }
}

function resourceContentsToString(resource: ResourceContents): string {
  if ("text" in resource) {
    return resource.text;
  }

  return `[blob: ${resource.uri}]`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
