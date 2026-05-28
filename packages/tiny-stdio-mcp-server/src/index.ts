// Server
export { createServer } from "./server.js";
export type { MessageHandler, MessageSession, Server } from "./server.js";

// Schema
export { defineSchema } from "./schema.js";
export type { TypedSchema } from "./schema.js";

// Content helpers
export {
  Image,
  Audio,
  File,
  toContentBlocks,
  fileTypeFromBuffer,
} from "./content/index.js";
export type {
  ImageContent,
  AudioContent,
  EmbeddedResource,
  TextResourceContents,
  BlobResourceContents,
  ContentBlock,
  TextContent,
  FileTypeResult,
} from "./content/index.js";
export type { ToolReturn } from "./content/index.js";

// Types
export type {
  ServerOptions,
  ToolHandler,
  ToolDefinition,
  Tool,
  CallToolResult,
  HandleResult,
  ContentItem,
  JSONSchema,
  JSONSchemaProperty,
  Transport,
  SDKTransport,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCNotification,
  InitializeResult,
} from "./types.js";

export { JSON_RPC_ERROR_CODES, ToolError } from "./types.js";
