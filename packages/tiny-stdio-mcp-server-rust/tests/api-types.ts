import type * as Reference from "tiny-stdio-mcp-server";
import type * as Native from "../src/index.js";
import { createServer, defineSchema, JSON_RPC_ERROR_CODES } from "../src/index.js";

type PublicContracts = [
  Native.JSONRPCError,
  Native.JSONSchema,
  Native.JSONSchemaProperty,
  Native.OutputSchema,
  Native.Implementation,
  Native.InitializeResult,
  Native.DiscoverResult,
  Native.Tool,
  Native.ToolAnnotations,
  Native.ToolExecution,
  Native.Icon,
  Native.ContentAnnotations,
  Native.ResourceLink,
  Native.CallToolResult,
  Native.PromptContentItem,
  Native.PromptMessage,
  Native.GetPromptResult,
  Native.PromptDefinition,
  Native.ResourceContents,
  Native.ReadResourceResult,
  Native.ResourceDefinition,
  Native.ResourceTemplateDefinition,
  Native.InputRequiredResult,
  Native.ToolDefinition<{ message: string }>,
  Native.ToolHandler<{ message: string }>,
  Native.MessageHandler
];
declare const contracts: PublicContracts;
void contracts;
const code: -32603 = JSON_RPC_ERROR_CODES.INTERNAL_ERROR;
void code;
const native: Native.Server = createServer({ name: "test", version: "1" });
const referenceCompatible: Reference.Server = native;
void referenceCompatible;
native.registerTool(
  { name: "typed", inputSchema: defineSchema({ message: { type: "string" } }) },
  (args: { message: string }) => args.message
);
const handler: Native.ToolHandler<{ message: string }> = (args) => args.message;
const definition: Native.ToolDefinition<{ message: string }> = {
  name: "typed",
  inputSchema: defineSchema({ message: { type: "string" } }),
  handler
};
void definition;
