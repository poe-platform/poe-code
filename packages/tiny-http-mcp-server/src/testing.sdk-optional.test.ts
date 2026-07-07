import { describe, expect, it, vi } from "vitest";
import type { HttpServer } from "./http-server.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
});
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  throw new Error("Cannot find package '@modelcontextprotocol/sdk'");
});

describe("testing module without @modelcontextprotocol/sdk", () => {
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
});
