import type { McpClient, CallToolResult, GetPromptResult, CompleteResult } from "./index.js";

type ToolList = Awaited<ReturnType<McpClient["listTools"]>>;
type ResourceList = Awaited<ReturnType<McpClient["listResources"]>>;
type TemplateList = Awaited<ReturnType<McpClient["listResourceTemplates"]>>;
type PromptList = Awaited<ReturnType<McpClient["listPrompts"]>>;
type ResourceRead = Awaited<ReturnType<McpClient["readResource"]>>;

declare const lists: ToolList | ResourceList | TemplateList | PromptList | ResourceRead;
const freshness: number | undefined = lists.ttlMs;
const scope: "private" | "public" | undefined = lists.cacheScope;
const listKind: "complete" | undefined = lists.resultType;
const listMetadata: Record<string, unknown> | undefined = lists._meta;
declare const result: CallToolResult | GetPromptResult | CompleteResult;
const kind: "complete" | undefined = result.resultType;
const metadata: Record<string, unknown> | undefined = result._meta;
void [freshness, scope, listKind, listMetadata, kind, metadata];
