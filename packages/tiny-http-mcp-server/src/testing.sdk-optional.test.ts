import "../vitest.setup.js";
import { describe, expect, it, vi } from "vitest";
import type { HttpServer } from "./http-server.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
});
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
});
vi.mock("tiny-mcp-client", () => {
  throw new Error("Cannot find package 'tiny-mcp-client'");
});

describe("testing module without @modelcontextprotocol/sdk", () => {
  it("imports test-support without the SDK installed", async () => {
    const testSupport = await import("./test-support.js");
    expect(typeof testSupport.installInMemoryHttp).toBe("function");
  });

  it("imports without the SDK installed", async () => {
    const testing = await import("./testing.js");
    expect(typeof testing.createInMemoryTokenVerifier).toBe("function");
  });

  it("rejects createHttpTestPair with a clear error before listening", async () => {
    const { createHttpTestPair } = await import("./testing.js");
    const listenHttp = vi.fn();
    const server = { listenHttp } as unknown as HttpServer;

    await expect(createHttpTestPair(server)).rejects.toThrow(
      "createHttpTestPair requires @modelcontextprotocol/sdk"
    );
    expect(listenHttp).not.toHaveBeenCalled();
  });

  it("rejects createHttpTestPairWithTinyClient with an actionable error", async () => {
    const { createHttpTestPairWithTinyClient } = await import("./testing.js");
    const listenHttp = vi.fn();
    const server = { listenHttp } as unknown as HttpServer;

    await expect(createHttpTestPairWithTinyClient(server)).rejects.toThrow(
      "install tiny-mcp-client as a devDependency"
    );
    expect(listenHttp).not.toHaveBeenCalled();
  });
});
