import { describe, expect, it } from "vitest";
import {
  createExpressMiddleware,
  createHttpServer,
  createServer,
} from "./index.js";
import {
  createHttpTestPair,
  createHttpTestPairWithTinyClient,
  createTestMcpServer,
} from "./testing.js";

describe("tiny-http-mcp-server", () => {
  it("re-exports stdio server helpers", () => {
    expect(createServer).toBeTypeOf("function");
    expect(createExpressMiddleware).toBeTypeOf("function");
    expect(createTestMcpServer).toBeTypeOf("function");
    expect(createHttpTestPair).toBeTypeOf("function");
    expect(createHttpTestPairWithTinyClient).toBeTypeOf("function");
  });

  it("creates an HTTP server with the runtime helpers attached", () => {
    const server = createHttpServer({ name: "test-server", version: "1.0.0" });

    expect(server.tool).toBeTypeOf("function");
    expect(server.listenHttp).toBeTypeOf("function");
    expect(server.handleRequest).toBeTypeOf("function");
  });
});
