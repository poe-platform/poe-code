import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseArgs: vi.fn(),
  listen: vi.fn(),
  dispose: vi.fn(),
  createServer: vi.fn(),
  options: { cwd: "/workspace" }
}));

vi.mock("node:util", () => ({ parseArgs: mocks.parseArgs }));
vi.mock("./index.js", () => ({
  createSafeBashMcpServer: mocks.createServer,
  default: mocks.options
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.parseArgs.mockReturnValue({ values: {} });
  mocks.listen.mockResolvedValue(undefined);
  mocks.dispose.mockResolvedValue(undefined);
  mocks.createServer.mockReturnValue({ listen: mocks.listen, close: mocks.dispose });
});

describe("safe-bash MCP stdio entry", () => {
  it("starts the SDK server and disposes its shell after EOF", async () => {
    await import("./cli.js");
    expect(mocks.createServer).toHaveBeenCalledWith({});
    expect(mocks.listen).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.parseArgs).toHaveBeenCalledWith({
      options: { config: { type: "string" } }, strict: true, allowPositionals: false
    });
  });

  it("loads trusted module options through --config for SDK parity", async () => {
    mocks.parseArgs.mockReturnValue({ values: { config: fileURLToPath(new URL("./index.ts", import.meta.url)) } });
    await import("./cli.js");
    expect(mocks.createServer).toHaveBeenCalledWith(mocks.options);
  });

  it("cleans up when stdio fails", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("transport failed"));
    await expect(import("./cli.js")).rejects.toThrow("transport failed");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
