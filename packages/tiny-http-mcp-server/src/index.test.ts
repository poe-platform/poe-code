import { describe, expect, expectTypeOf, it } from "vitest";
import {
  Audio,
  createExpressMiddleware,
  createHttpServer,
  createServer,
  defineSchema,
  File,
  fileTypeFromBuffer,
  Image,
  JSON_RPC_ERROR_CODES,
  toContentBlocks,
} from "./index.js";
import {
  createHttpTestPair,
  createHttpTestPairWithTinyClient,
  createTestMcpServer,
} from "./testing.js";
import type {
  AudioContent,
  BlobResourceContents,
  CallToolResult,
  ContentBlock,
  ContentItem,
  EmbeddedResource,
  FileTypeResult,
  HandleResult,
  HttpListenOptions,
  HttpServer,
  HttpServerHandle,
  HttpTransportOptions,
  ImageContent,
  InitializeResult,
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONSchema,
  JSONSchemaProperty,
  SDKTransport,
  Server,
  ServerOptions,
  TextContent,
  TextResourceContents,
  Tool,
  ToolDefinition,
  ToolHandler,
  ToolReturn,
  Transport,
  TypedSchema,
} from "./index.js";

describe("tiny-http-mcp-server", () => {
  it("re-exports the full runtime entrypoint surface", async () => {
    expect(createServer).toBeTypeOf("function");
    expect(defineSchema).toBeTypeOf("function");
    expect(Image.fromBase64).toBeTypeOf("function");
    expect(Audio.fromBase64).toBeTypeOf("function");
    expect(File.fromText).toBeTypeOf("function");
    expect(toContentBlocks).toBeTypeOf("function");
    expect(fileTypeFromBuffer).toBeTypeOf("function");
    expect(JSON_RPC_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    expect(createExpressMiddleware).toBeTypeOf("function");
    expect(createHttpServer).toBeTypeOf("function");
    expect(createTestMcpServer).toBeTypeOf("function");
    expect(createHttpTestPair).toBeTypeOf("function");
    expect(createHttpTestPairWithTinyClient).toBeTypeOf("function");

    expect(fileTypeFromBuffer(Uint8Array.from([]))).toBeUndefined();
  });

  it("creates an HTTP server with the runtime helpers attached", () => {
    const server = createHttpServer({ name: "test-server", version: "1.0.0" });

    expect(server.tool).toBeTypeOf("function");
    expect(server.listenHttp).toBeTypeOf("function");
    expect(server.handleRequest).toBeTypeOf("function");
  });

  it("re-exports the stdio and HTTP type surface", () => {
    expectTypeOf<Server>().toMatchTypeOf<{
      tool: (...args: unknown[]) => Server;
      handleMessage: (...args: unknown[]) => Promise<HandleResult>;
    }>();
    expectTypeOf<TypedSchema<{ text: string }>>().toMatchTypeOf<JSONSchema>();
    expectTypeOf<ImageContent>().toMatchTypeOf<ContentItem>();
    expectTypeOf<AudioContent>().toMatchTypeOf<ContentItem>();
    expectTypeOf<EmbeddedResource>().toMatchTypeOf<ContentItem>();
    expectTypeOf<TextResourceContents>().toMatchTypeOf<{
      uri: string;
      mimeType: string;
      text: string;
    }>();
    expectTypeOf<BlobResourceContents>().toMatchTypeOf<{
      uri: string;
      mimeType: string;
      blob: string;
    }>();
    expectTypeOf<ContentBlock>().toMatchTypeOf<ContentItem>();
    expectTypeOf<TextContent>().toMatchTypeOf<{ type: "text"; text: string }>();
    expectTypeOf<FileTypeResult>().toMatchTypeOf<{
      ext: string;
      mime: string;
    }>();
    expectTypeOf<ToolReturn>().toMatchTypeOf<unknown>();
    expectTypeOf<ServerOptions>().toMatchTypeOf<{ name: string; version: string }>();
    expectTypeOf<ToolHandler<{ text: string }>>().toMatchTypeOf<
      (args: { text: string }) => ToolReturn | Promise<ToolReturn>
    >();
    expectTypeOf<ToolDefinition<{ text: string }>>().toMatchTypeOf<{
      name: string;
      description: string;
      inputSchema: JSONSchema;
      handler: ToolHandler<{ text: string }>;
    }>();
    expectTypeOf<Tool>().toMatchTypeOf<{
      name: string;
      description: string;
      inputSchema: JSONSchema;
    }>();
    expectTypeOf<CallToolResult>().toMatchTypeOf<{
      content: ContentItem[];
      isError?: boolean;
    }>();
    expectTypeOf<HandleResult>().toMatchTypeOf<{
      result?: unknown;
      error?: { code: number; message: string };
    }>();
    expectTypeOf<JSONSchemaProperty>().toMatchTypeOf<{
      type: "string" | "number" | "boolean" | "object" | "array";
      description?: string;
    }>();
    expectTypeOf<Transport>().toMatchTypeOf<{
      readable: NodeJS.ReadableStream;
      writable: NodeJS.WritableStream;
    }>();
    expectTypeOf<SDKTransport>().toMatchTypeOf<{
      start: () => Promise<void>;
      close: () => Promise<void>;
      send: (message: JSONRPCMessage) => Promise<void>;
    }>();
    expectTypeOf<JSONRPCRequest>().toMatchTypeOf<{
      jsonrpc: "2.0";
      id: string | number;
      method: string;
      params?: Record<string, unknown>;
    }>();
    expectTypeOf<JSONRPCResponse>().toMatchTypeOf<{
      jsonrpc: "2.0";
      id: string | number | null;
      result?: unknown;
      error?: JSONRPCError;
    }>();
    expectTypeOf<JSONRPCError>().toMatchTypeOf<{
      code: number;
      message: string;
      data?: unknown;
    }>();
    expectTypeOf<JSONRPCNotification>().toMatchTypeOf<{
      jsonrpc: "2.0";
      method: string;
      params?: Record<string, unknown>;
    }>();
    expectTypeOf<InitializeResult>().toMatchTypeOf<{
      protocolVersion: string;
      capabilities: { tools?: { listChanged?: boolean } };
      serverInfo: { name: string; version: string };
    }>();
    expectTypeOf<HttpTransportOptions>().toMatchTypeOf<object>();
    expectTypeOf<HttpListenOptions>().toMatchTypeOf<{
      port?: number;
      hostname?: string;
      path?: string;
      signal?: AbortSignal;
    }>();
    expectTypeOf<HttpServerHandle>().toMatchTypeOf<{
      url: string;
      port: number;
      close: () => Promise<void>;
    }>();
    expectTypeOf<HttpServer>().toMatchTypeOf<{
      tool: (...args: unknown[]) => HttpServer;
      listenHttp: (options?: HttpListenOptions) => Promise<HttpServerHandle>;
    }>();
  });
});
