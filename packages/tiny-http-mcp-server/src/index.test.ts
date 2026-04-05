import { describe, expect, it } from "vitest";
import {
  createHttpHandler,
  createHttpServer,
  createServer,
  HttpTransportNotImplementedError,
} from "./index.js";
import { createTestPair } from "./testing.js";

describe("tiny-http-mcp-server", () => {
  it("re-exports stdio server helpers", () => {
    expect(createServer).toBeTypeOf("function");
    expect(createTestPair).toBeTypeOf("function");
  });

  it("exposes placeholder HTTP helpers", () => {
    expect(() => createHttpHandler()).toThrow(HttpTransportNotImplementedError);
    expect(() => createHttpServer()).toThrow("HTTP transport is not implemented yet.");
  });
});
