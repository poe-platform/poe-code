import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { expect, it, vi } from "vitest";
import { StdioTransport } from "./stdio-transport.js";

vi.mock("#tiny-mcp-spawn", () => import("./spawn.browser.js"));

it("requires an explicit process adapter on portable hosts", () => {
  expect(() => new StdioTransport({ command: "server" })).toThrow("explicit MCP process adapter");
});

it("retains supplied process adapters and their lifecycle on portable hosts", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, signalCode: null, killed: false,
    kill: vi.fn(() => true)
  });
  const spawn = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
  const transport = new StdioTransport({ command: "server", args: ["--stdio"], env: { TOKEN: "test" }, spawn });
  expect(spawn).toHaveBeenCalledWith("server", ["--stdio"], expect.objectContaining({ env: { TOKEN: "test" } }));
  expect(transport.readable).toBe(child.stdout);
  expect(transport.writable).toBe(child.stdin);
  transport.dispose();
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  child.emit("exit", 0, null);
  await expect(transport.closed).resolves.toMatchObject({ code: 0 });
});
