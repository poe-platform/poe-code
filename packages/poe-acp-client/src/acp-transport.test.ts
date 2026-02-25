import { type ChildProcessWithoutNullStreams, spawn as spawnChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { AcpTransport } from "./acp-transport.js";
import type {
  InitializeResponse,
  SessionNotification,
  SessionUpdate,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from "./types.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

interface MockChildProcess {
  child: ChildProcessWithoutNullStreams;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals | number) => boolean>>;
  getStdin: () => string;
  emitClose: (code?: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (error: Error) => void;
}

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
  vi.clearAllMocks();
});

function createMockChildProcess(): MockChildProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let stdinBuffer = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    stdinBuffer += String(chunk);
  });

  let closed = false;

  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & {
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };

  const emitClose = (code: number | null = 0, signal: NodeJS.Signals | null = null) => {
    if (closed) {
      return;
    }

    closed = true;
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("close", code, signal);
  };

  const kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>((signal) => {
    child.killed = true;
    const normalizedSignal = typeof signal === "string" ? signal : "SIGTERM";
    emitClose(null, normalizedSignal);
    return true;
  });

  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = kill;

  return {
    child,
    stdin,
    stdout,
    stderr,
    kill,
    getStdin: () => stdinBuffer,
    emitClose,
    emitError: (error: Error) => {
      child.emit("error", error);
    },
  };
}

function parseOutbound(raw: string): unknown[] {
  if (raw.length === 0) {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

async function waitForOutboundCount(mock: MockChildProcess, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(parseOutbound(mock.getStdin())).toHaveLength(count);
  });
}

describe("AcpTransport", () => {
  it("spawns the agent process and sends typed JSON-RPC requests", async () => {
    const mock = createMockChildProcess();
    const spawnMock = vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({
      command: "poe-agent",
      args: ["--stdio"],
      cwd: "/tmp/work",
      env: { FOO: "bar" },
    });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "poe-agent",
      ["--stdio"],
      expect.objectContaining({
        cwd: "/tmp/work",
        env: { FOO: "bar" },
        stdio: ["pipe", "pipe", "pipe"],
      })
    );

    const initialize = transport.sendRequest("initialize", { protocolVersion: 1 });
    expectTypeOf(initialize).toEqualTypeOf<Promise<InitializeResponse>>();

    await waitForOutboundCount(mock, 1);
    const [outbound] = parseOutbound(mock.getStdin()) as Array<{
      id: number | string | null;
    }>;
    mock.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        result: { protocolVersion: 1 },
      }) + "\n"
    );

    await expect(initialize).resolves.toEqual({ protocolVersion: 1 });
  });

  it("sends notifications without awaiting a response", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    transport.sendNotification("session/cancel", { sessionId: "s-1" });

    await waitForOutboundCount(mock, 1);
    const [outbound] = parseOutbound(mock.getStdin()) as Array<{
      method: string;
      params: { sessionId: string };
      id?: unknown;
    }>;

    expect(outbound).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "s-1" },
    });
    expect(outbound.id).toBeUndefined();
  });

  it("sends underscore-prefixed extension requests and resolves typed responses", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    const pending = transport.sendExtRequest<{ accepted: boolean }>("_custom/ping", {
      value: 7,
    });

    await waitForOutboundCount(mock, 1);
    const [outbound] = parseOutbound(mock.getStdin()) as Array<{
      id: number | string | null;
      method: string;
      params: { value: number };
    }>;

    expect(outbound.method).toBe("_custom/ping");
    expect(outbound.params).toEqual({ value: 7 });

    mock.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        result: { accepted: true },
      }) + "\n"
    );

    await expect(pending).resolves.toEqual({ accepted: true });
  });

  it("sends underscore-prefixed extension notifications", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    transport.sendExtNotification("_custom/note", { value: 9 });

    await waitForOutboundCount(mock, 1);
    const [outbound] = parseOutbound(mock.getStdin()) as Array<{
      method: string;
      params: { value: number };
      id?: unknown;
    }>;

    expect(outbound).toEqual({
      jsonrpc: "2.0",
      method: "_custom/note",
      params: { value: 9 },
    });
    expect(outbound.id).toBeUndefined();
  });

  it("registers and dispatches underscore-prefixed extension handlers", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    const requestHandler = vi.fn((params: { value: number }) => ({
      doubled: params.value * 2,
    }));
    const notificationHandler = vi.fn();

    transport.onExtRequest("_custom/request", requestHandler);
    transport.onExtNotification("_custom/note", notificationHandler);

    mock.stdout.write(
      '{"jsonrpc":"2.0","id":"ext-1","method":"_custom/request","params":{"value":21}}\n'
    );
    mock.stdout.write(
      '{"jsonrpc":"2.0","method":"_custom/note","params":{"value":13}}\n'
    );

    await vi.waitFor(() => {
      expect(requestHandler).toHaveBeenCalledTimes(1);
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });

    await waitForOutboundCount(mock, 1);
    const [response] = parseOutbound(mock.getStdin()) as Array<{
      id: string;
      result: { doubled: number };
    }>;

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "ext-1",
      result: { doubled: 42 },
    });
    expect(notificationHandler).toHaveBeenCalledWith(
      { value: 13 },
      { method: "_custom/note" }
    );
  });

  it("rejects extension methods without underscore prefix", () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    const requestHandler = vi.fn();
    const notificationHandler = vi.fn();

    expect(() => transport.sendExtRequest("session/new", { cwd: "/tmp/work" })).toThrow(
      'Extension method must start with "_"'
    );
    expect(() => transport.sendExtNotification("session/cancel", { sessionId: "s-1" })).toThrow(
      'Extension method must start with "_"'
    );
    expect(() => transport.onExtRequest("session/new", requestHandler)).toThrow(
      'Extension method must start with "_"'
    );
    expect(() => transport.onExtNotification("session/update", notificationHandler)).toThrow(
      'Extension method must start with "_"'
    );
  });

  it("registers and dispatches incoming request and notification handlers", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    const requestHandler = vi.fn(
      (params: WaitForTerminalExitRequest): WaitForTerminalExitResponse => ({
        exitCode: params.terminalId.length,
      })
    );
    const notificationHandler = vi.fn();

    transport.onRequest("terminal/wait_for_exit", requestHandler);
    transport.onNotification("session/update", notificationHandler);

    mock.stdout.write(
      '{"jsonrpc":"2.0","id":"req-1","method":"terminal/wait_for_exit","params":{"sessionId":"s-1","terminalId":"term-9"}}\n'
    );

    const update: SessionNotification = {
      sessionId: "s-1",
      update: {
        sessionUpdate: "usage_update",
        used: 3,
        size: 10,
      } satisfies SessionUpdate,
    };
    mock.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: update,
      }) + "\n"
    );

    await vi.waitFor(() => {
      expect(requestHandler).toHaveBeenCalledTimes(1);
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });

    await waitForOutboundCount(mock, 1);
    const [response] = parseOutbound(mock.getStdin()) as Array<{
      id: string;
      result: WaitForTerminalExitResponse;
    }>;

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      result: { exitCode: 6 },
    });
    expect(notificationHandler).toHaveBeenCalledWith(update, { method: "session/update" });
  });

  it("rejects pending requests when the process exits", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    const pending = transport.sendRequest("initialize", { protocolVersion: 1 });

    await waitForOutboundCount(mock, 1);
    mock.emitClose(0, null);

    await expect(pending).rejects.toThrow('ACP transport closed (command "poe-agent", code: 0)');
    await expect(transport.closed).resolves.toMatchObject({
      code: 0,
      signal: null,
    });
  });

  it("captures stderr for diagnostics and disposes gracefully", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    mock.stderr.write("agent warning\n");
    mock.stderr.write(Buffer.from("agent stack trace"));

    expect(transport.getStderrOutput()).toBe("agent warning\nagent stack trace");

    transport.dispose();

    expect(mock.kill).toHaveBeenCalledTimes(1);
    expect(mock.stdin.writableEnded).toBe(true);
    await expect(transport.closed).resolves.toMatchObject({
      signal: "SIGTERM",
      stderr: "agent warning\nagent stack trace",
      reason: expect.objectContaining({
        message: "ACP transport disposed",
      }),
    });
  });

  it("rejects pending requests when the process errors", async () => {
    const mock = createMockChildProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(mock.child);
    const transport = new AcpTransport({ command: "poe-agent" });
    cleanup.push(() => {
      transport.dispose();
      mock.stdin.destroy();
      mock.stdout.destroy();
      mock.stderr.destroy();
    });

    const pending = transport.sendRequest("initialize", { protocolVersion: 1 });
    const error = new Error("spawn failed");

    await waitForOutboundCount(mock, 1);
    mock.emitError(error);

    await expect(pending).rejects.toThrow("spawn failed");
    await expect(transport.closed).resolves.toMatchObject({
      reason: error,
    });
  });
});
