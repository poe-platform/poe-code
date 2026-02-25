import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StdioTransport, readLines, type StdioSpawn } from "./internal.js";

const testServerCli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tiny-stdio-mcp-test-server/dist/cli.js"
);

const streamsForCleanup: PassThrough[] = [];

afterEach(() => {
  while (streamsForCleanup.length > 0) {
    streamsForCleanup.pop()?.destroy();
  }
});

interface MockChildProcess extends ChildProcessWithoutNullStreams {
  emitExit: (code?: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (error: Error) => void;
}

async function readSingleLineWithTimeout(
  transport: StdioTransport,
  timeoutMs: number
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for stdout line after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const nextLine = (async () => {
    for await (const line of readLines(transport.readable)) {
      return line;
    }
    throw new Error("Stdio transport stdout ended before any response line was read");
  })();

  const closedBeforeLine = transport.closed.then((closedEvent) => {
    throw new Error(
      `Process closed before stdout response: ${closedEvent.reason.message}`
    );
  });

  try {
    return await Promise.race([nextLine, timeout, closedBeforeLine]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function createMockChildProcess(): MockChildProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  streamsForCleanup.push(stdin, stdout, stderr);

  const child = new EventEmitter() as unknown as MockChildProcess & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    killed: boolean;
    kill: (signal?: NodeJS.Signals) => boolean;
    signalCode: NodeJS.Signals | null;
  };

  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    child.killed = true;
    child.emitExit(null, signal ?? "SIGTERM");
    return true;
  });
  child.signalCode = null;
  child.emitExit = (code = null, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  child.emitError = (error: Error) => {
    child.emit("error", error);
  };

  return child;
}

describe("StdioTransport constructor", () => {
  it("calls spawn with command and args", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    new StdioTransport({
      command: "tiny-stdio-mcp-test-server",
      args: ["--mode", "stdio"],
      spawn,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      "tiny-stdio-mcp-test-server",
      ["--mode", "stdio"],
      {
        cwd: undefined,
        env: undefined,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  });

  it("passes cwd and env through to spawn", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const env: NodeJS.ProcessEnv = { MCP_TOKEN: "token-123" };

    new StdioTransport({
      command: "node",
      args: ["server.js"],
      cwd: "/tmp/mcp",
      env,
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith("node", ["server.js"], {
      cwd: "/tmp/mcp",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("sets readable and writable to child stdout and stdin", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    expect(transport.readable).toBe(child.stdout);
    expect(transport.writable).toBe(child.stdin);
  });

  it("uses provided custom spawn function", () => {
    const child = createMockChildProcess();
    const customSpawn = vi.fn<StdioSpawn>(() => child);

    new StdioTransport({
      command: "custom-bin",
      spawn: customSpawn,
    });

    expect(customSpawn).toHaveBeenCalledTimes(1);
    expect(customSpawn).toHaveBeenCalledWith("custom-bin", [], {
      cwd: undefined,
      env: undefined,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
});

describe("StdioTransport stderr capture", () => {
  it("returns concatenated stderr chunks", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.stderr.write("first");
    child.stderr.write(" second");

    expect(transport.getStderrOutput()).toBe("first second");
  });

  it("caps stderr at 64KB keeping the tail", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);

    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    const chunk = "x".repeat(40_000);
    child.stderr.write(chunk);
    child.stderr.write(chunk);

    const output = transport.getStderrOutput();
    expect(output.length).toBe(65_536);
    expect(output).toBe((chunk + chunk).slice(-65_536));
  });
});

describe("StdioTransport closed promise", () => {
  it("resolves when the process exits with code 0", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.emitExit(0, null);

    const closed = await transport.closed;
    expect(closed.reason).toBeInstanceOf(Error);
    expect(closed.code).toBe(0);
    expect(closed.signal).toBeUndefined();
  });

  it("resolves with code 1 when the process crashes", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.emitExit(1, null);

    const closed = await transport.closed;
    expect(closed.reason).toBeInstanceOf(Error);
    expect(closed.reason.message).toBe("Stdio transport process exited");
    expect(closed.code).toBe(1);
    expect(closed.signal).toBeUndefined();
  });

  it("resolves with signal when the process exits from SIGTERM", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });

    child.emitExit(null, "SIGTERM");

    const closed = await transport.closed;
    expect(closed.reason).toBeInstanceOf(Error);
    expect(closed.code).toBeUndefined();
    expect(closed.signal).toBe("SIGTERM");
  });

  it("resolves with process error reason when process emits error", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });
    const processError = new Error("spawn failed");

    child.emitError(processError);

    const closed = await transport.closed;
    expect(closed.reason).toBe(processError);
    expect(closed.code).toBeUndefined();
    expect(closed.signal).toBeUndefined();
  });
});

describe("StdioTransport dispose", () => {
  it("ends stdin, sends SIGTERM, and resolves closed", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });
    const endSpy = vi.spyOn(child.stdin, "end");

    transport.dispose();

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    const closed = await transport.closed;
    expect(closed.signal).toBe("SIGTERM");
  });

  it("does not throw when dispose is called twice", () => {
    const child = createMockChildProcess();
    const spawn = vi.fn<StdioSpawn>(() => child);
    const transport = new StdioTransport({
      command: "node",
      spawn,
    });
    const endSpy = vi.spyOn(child.stdin, "end");

    expect(() => {
      transport.dispose();
      transport.dispose();
    }).not.toThrow();

    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});

describe("StdioTransport real process smoke test", () => {
  it("spawns tiny-stdio-mcp-test-server and round-trips initialize over stdio", async () => {
    const transport = new StdioTransport({
      command: process.execPath,
      args: [testServerCli, "serve", "word-of-the-day"],
    });

    try {
      transport.writable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "tiny-mcp-client-smoke-test",
              version: "0.0.0-test",
            },
          },
        })}\n`
      );

      const line = await readSingleLineWithTimeout(transport, 5000);
      const response = JSON.parse(line) as {
        jsonrpc: string;
        id: number;
        result: {
          protocolVersion: string;
          serverInfo: { name: string; version: string };
          capabilities: { tools: { listChanged: boolean } };
        };
      };

      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(1);
      expect(response.result.protocolVersion).toBe("2025-03-26");
      expect(response.result.serverInfo).toEqual({
        name: "tiny-stdio-mcp-test-server",
        version: "0.0.1",
      });
      expect(response.result.capabilities.tools.listChanged).toBe(true);
    } finally {
      transport.dispose();
      const closed = await transport.closed;
      expect(closed.reason).toBeInstanceOf(Error);
      expect(closed.signal ?? closed.code).toBeDefined();
    }
  });
});
