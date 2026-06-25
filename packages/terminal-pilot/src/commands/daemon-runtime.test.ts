import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDaemonTerminalPilotRuntime } from "./daemon-runtime.js";

type RpcRequest = {
  id: number;
  method: string;
  params?: {
    params?: Record<string, unknown>;
  };
};

function mockDaemonRpc(requests: RpcRequest[]): void {
  vi.spyOn(net, "createConnection").mockImplementation(() => {
    const socket = new EventEmitter() as EventEmitter & {
      setEncoding: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };

    socket.setEncoding = vi.fn();
    socket.end = vi.fn();
    socket.write = vi.fn((line: string) => {
      const request = JSON.parse(line) as RpcRequest;
      requests.push(request);

      const result =
        request.method === "createSession"
          ? {
              name: "s1",
              session: {
                id: "session-1",
                command: "pwd",
                pid: 123,
                exitCode: null
              }
            }
          : { ok: true };

      queueMicrotask(() => {
        socket.emit("data", `${JSON.stringify({ id: request.id, ok: true, result })}\n`);
      });
    });

    queueMicrotask(() => {
      socket.emit("connect");
    });

    return socket as never;
  });
}

describe("daemon terminal-pilot runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the caller cwd when create-session omits --cwd", async () => {
    const requests: RpcRequest[] = [];
    mockDaemonRpc(requests);
    vi.spyOn(process, "cwd").mockReturnValue("/caller/workspace/package");

    const runtime = createDaemonTerminalPilotRuntime();

    await expect(runtime.createSession({ command: "pwd" })).resolves.toMatchObject({
      name: "s1"
    });

    const createSessionRequest = requests.find((request) => request.method === "createSession");
    expect(createSessionRequest?.params?.params).toMatchObject({
      command: "pwd",
      cwd: "/caller/workspace/package"
    });
  });

  it("preserves an explicit create-session cwd", async () => {
    const requests: RpcRequest[] = [];
    mockDaemonRpc(requests);
    vi.spyOn(process, "cwd").mockReturnValue("/caller/workspace/package");

    const runtime = createDaemonTerminalPilotRuntime();

    await expect(
      runtime.createSession({ command: "pwd", cwd: "/explicit/project" })
    ).resolves.toMatchObject({
      name: "s1"
    });

    const createSessionRequest = requests.find((request) => request.method === "createSession");
    expect(createSessionRequest?.params?.params).toMatchObject({
      command: "pwd",
      cwd: "/explicit/project"
    });
  });
});
