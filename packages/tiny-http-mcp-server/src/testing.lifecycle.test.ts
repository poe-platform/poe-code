import "../vitest.setup.js";
import { describe, expect, it, vi } from "vitest";
import type { HttpServer } from "./http-server.js";

const { clientClose, clientConnect } = vi.hoisted(() => ({
  clientClose: vi.fn(),
  clientConnect: vi.fn()
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class Client {
    connect = clientConnect;
    close = clientClose;
  }
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class StreamableHTTPClientTransport {}
}));

import { createHttpTestPair } from "./testing.js";

describe("createHttpTestPair cleanup", () => {
  it("closes its listener when client connection fails", async () => {
    const handleClose = vi.fn(async () => undefined);
    clientConnect.mockRejectedValueOnce(new Error("connect failed"));
    const server = {
      listenHttp: vi.fn(async () => ({
        url: "http://127.0.0.1:4040/mcp",
        port: 4040,
        close: handleClose
      }))
    } as unknown as HttpServer;

    await expect(createHttpTestPair(server)).rejects.toThrow("connect failed");
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("closes its listener when client cleanup fails", async () => {
    const handleClose = vi.fn(async () => undefined);
    clientConnect.mockResolvedValueOnce(undefined);
    clientClose.mockRejectedValueOnce(new Error("client close failed"));
    const server = {
      listenHttp: vi.fn(async () => ({
        url: "http://127.0.0.1:4040/mcp",
        port: 4040,
        close: handleClose
      }))
    } as unknown as HttpServer;
    const pair = await createHttpTestPair(server);

    await expect(pair.cleanup()).rejects.toThrow("client close failed");
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
