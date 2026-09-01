import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { Shell, timeEnvCommands } from "poe-code/safe-bash";
import { createSafeBashMcpServer } from "./index.js";

describe("MCP connection lifetime", () => {
  it.each(["end", "close", "read-error", "write-error", "write-close", "server-close"])(
    "cancels active sleep and queued execution on %s, then removes listeners", async event => {
    const scheduler = { now: () => 0, setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() };
    const server = createSafeBashMcpServer({
      createShell: options => new Shell(options).use(timeEnvCommands({ scheduler, replace: true }))
    });
    const exec = vi.spyOn(server.shell, "exec");
    const readable = new PassThrough();
    const writable = new PassThrough();
    const events = ["end", "close", "error"];
    const beforeRead = events.map(name => readable.listenerCount(name));
    const beforeWrite = events.map(name => writable.listenerCount(name));
    let output = "";
    writable.on("data", chunk => { output += chunk.toString(); });
    let settled = false;
    const failure = new Error("transport failed");
    const connection = server.connect({ readable, writable }).then(
      () => ({ error: undefined }),
      error => ({ error })
    ).finally(() => { settled = true; });
    try {
      readable.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-11-25", clientInfo: { name: "lifetime", version: "1" }
      } }) + "\n");
      await vi.waitFor(() => expect(output).toContain('"id":1'), { interval: 1 });
      for (const [id, command] of [[2, "sleep 60"], [3, "printf queued"]]) {
        readable.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: {
          name: "shell_execute", arguments: { command }
        } }) + "\n");
      }
      await vi.waitFor(() => expect(scheduler.setTimeout).toHaveBeenCalledOnce(), { interval: 1 });
      if (event === "end") readable.end();
      else if (event === "close") readable.emit("close");
      else if (event === "read-error") readable.emit("error", failure);
      else if (event === "write-error") writable.emit("error", failure);
      else if (event === "write-close") writable.emit("close");
      else void server.close();
      await vi.waitFor(() => expect(settled).toBe(true), { interval: 1, timeout: 100 });
      const outcome = await connection;
      expect(outcome.error).toBe(event.endsWith("error") ? failure : undefined);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(scheduler.clearTimeout).toHaveBeenCalledOnce();
      expect(output).not.toContain("queued");
      expect(events.map(name => readable.listenerCount(name))).toEqual(beforeRead);
      expect(events.map(name => writable.listenerCount(name))).toEqual(beforeWrite);
    } finally {
      readable.end();
      await server.shell.dispose();
      await connection;
      readable.destroy();
      writable.destroy();
    }
    }
  );

  it("closes only once and rejects later calls before reaching the shell", async () => {
    const server = createSafeBashMcpServer();
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25", clientInfo: { name: "close", version: "1" } });
    const dispose = vi.spyOn(server.shell, "dispose");
    const exec = vi.spyOn(server.shell, "exec");
    const first = server.close();
    expect(server.close()).toBe(first);
    await first;
    expect(dispose).toHaveBeenCalledOnce();
    const response = await server.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "printf late" } });
    expect(response.result).toMatchObject({ isError: true });
    expect(exec).not.toHaveBeenCalled();
  });

  it("reports disposal errors while still removing input and output listeners", async () => {
    const failure = new Error("plugin cleanup failed");
    const server = createSafeBashMcpServer({
      createShell: options => new Shell(options).use({ name: "cleanup", setup() {}, dispose() { throw failure; } })
    });
    await server.shell.exec("true");
    const readable = new PassThrough();
    const writable = new PassThrough();
    const readErrors = readable.listenerCount("error");
    const writeErrors = writable.listenerCount("error");
    const connection = server.connect({ readable, writable });
    const result = expect(connection).rejects.toThrow("Plugin disposal failed");
    readable.end();
    await result;
    expect(readable.listenerCount("error")).toBe(readErrors);
    expect(writable.listenerCount("error")).toBe(writeErrors);
    readable.destroy();
    writable.destroy();
  });
});
