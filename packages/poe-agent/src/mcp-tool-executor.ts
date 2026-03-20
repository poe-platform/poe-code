import type { CallToolResult, ContentItem, ResourceContents } from "tiny-mcp-client";

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

export function namespaceMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

export function callToolResultToString(result: CallToolResult): string {
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
      return resourceContentsToString(item.resource);
  }
}

function resourceContentsToString(resource: ResourceContents): string {
  if ("text" in resource) {
    return resource.text;
  }

  return `[blob: ${resource.uri}]`;
}

