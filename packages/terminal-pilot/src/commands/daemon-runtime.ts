import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { UserError } from "toolcraft";
import {
  SESSION_ENV_VAR,
  createTerminalPilotRuntime,
  type TerminalPilotRuntime
} from "./runtime.js";
import type { TerminalKey } from "../keys.js";
import type { TerminalSession, WaitForOptions } from "../terminal-session.js";

const RUNTIME_DIR_ENV = "TERMINAL_PILOT_RUNTIME_DIR";
const DAEMON_ARG = "__daemon";
const START_TIMEOUT_MS = 5_000;
const IDLE_SHUTDOWN_MS = 1_000;

type SessionInfo = {
  id: string;
  command: string;
  pid: number;
  exitCode: number | null;
};

type RpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type RpcResponse =
  | {
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      id: number;
      ok: false;
      error: { message: string };
    };

type HandlerEnvLike = {
  get(key: string): string | undefined;
};

type SessionProxy = Pick<
  TerminalSession,
  | "id"
  | "command"
  | "pid"
  | "exitCode"
  | "fill"
  | "type"
  | "press"
  | "signal"
  | "waitFor"
  | "waitForExit"
  | "screen"
  | "history"
  | "resize"
  | "close"
>;

export function isTerminalPilotDaemonArgv(argv: string[]): boolean {
  return argv[2] === DAEMON_ARG;
}

export async function runTerminalPilotDaemon(): Promise<void> {
  const runtime = createTerminalPilotRuntime();
  const socketPath = resolveSocketPath(process.env);
  await mkdir(path.dirname(socketPath), { recursive: true });
  if (process.platform !== "win32") {
    await unlink(socketPath).catch(() => undefined);
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        void handleRequestLine(runtime, line).then((response) => {
          socket.write(`${JSON.stringify(response)}\n`);
          scheduleIdleShutdown();
        });
      }
    });
  });

  async function shutdown(): Promise<void> {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    await runtime.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (process.platform !== "win32") {
      await unlink(socketPath).catch(() => undefined);
    }
  }

  async function scheduleIdleShutdown(): Promise<void> {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }

    if (await runtime.hasRetainedSessions()) {
      return;
    }

    idleTimer = setTimeout(() => {
      void shutdown().then(() => {
        process.exit(0);
      });
    }, IDLE_SHUTDOWN_MS);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function createDaemonTerminalPilotRuntime(): TerminalPilotRuntime {
  let nextId = 1;

  async function request<T>(method: string, params?: unknown): Promise<T> {
    await ensureDaemon();
    return sendRequest<T>(method, params, nextId++);
  }

  function proxySession(name: string, info: SessionInfo): SessionProxy {
    return {
      id: info.id,
      command: info.command,
      pid: info.pid,
      exitCode: info.exitCode,
      fill: async (text: string) => {
        await request("sessionAction", { name, action: "fill", args: [text] });
      },
      type: async (text: string) => {
        await request("sessionAction", { name, action: "type", args: [text] });
      },
      press: async (key: string) => {
        await request("sessionAction", { name, action: "press", args: [key] });
      },
      signal: async (signal: string) => {
        await request("sessionAction", { name, action: "signal", args: [signal] });
      },
      waitFor: async (pattern: string | RegExp, options?: WaitForOptions) =>
        request("sessionAction", {
          name,
          action: "waitFor",
          args: [serializePattern(pattern), options]
        }),
      waitForExit: async (options?: { timeout?: number }) =>
        request("sessionAction", { name, action: "waitForExit", args: [options] }),
      screen: async () => request("sessionAction", { name, action: "screen", args: [] }),
      history: async (options?: { last?: number }) =>
        request("sessionAction", { name, action: "history", args: [options] }),
      resize: async (cols: number, rows: number) => {
        await request("sessionAction", { name, action: "resize", args: [cols, rows] });
      },
      close: async () => {
        const result = await request<{ exitCode: number }>("closeSession", { name });
        return result.exitCode;
      }
    };
  }

  return {
    async createSession(params, env) {
      const result = await request<{ name: string; session: SessionInfo }>("createSession", {
        params: {
          ...params,
          cwd: params.cwd ?? process.cwd()
        },
        envSession: env?.get(SESSION_ENV_VAR)
      });
      return { name: result.name, session: proxySession(result.name, result.session) };
    },

    async resolveSession(name, env) {
      const result = await request<{ name: string; session: SessionInfo }>("resolveSession", {
        name,
        envSession: env?.get(SESSION_ENV_VAR)
      });
      return { name: result.name, session: proxySession(result.name, result.session) };
    },

    async closeSession(name, env) {
      return request("closeSession", {
        name,
        envSession: env?.get(SESSION_ENV_VAR)
      });
    },

    async listSessions() {
      const sessions = await request<Array<{ name: string; session: SessionInfo }>>("listSessions");
      return sessions.map((entry) => ({
        name: entry.name,
        session: proxySession(entry.name, entry.session)
      }));
    },

    async hasRetainedSessions() {
      return request("hasRetainedSessions");
    },

    async close() {
      await request("shutdown").catch(() => undefined);
    }
  };
}

async function handleRequestLine(
  runtime: TerminalPilotRuntime,
  line: string
): Promise<RpcResponse> {
  let request: RpcRequest;
  try {
    request = JSON.parse(line) as RpcRequest;
  } catch (error) {
    return {
      id: 0,
      ok: false,
      error: { message: error instanceof Error ? error.message : "Invalid request" }
    };
  }

  try {
    const result = await handleRequest(runtime, request);
    return { id: request.id, ok: true, result };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) }
    };
  }
}

async function handleRequest(runtime: TerminalPilotRuntime, request: RpcRequest): Promise<unknown> {
  const params = isRecord(request.params) ? request.params : {};

  if (request.method === "ping") {
    return { ok: true };
  }

  if (request.method === "createSession") {
    const createParams = isRecord(params.params) ? params.params : {};
    const namedSession = await runtime.createSession(
      createParams as unknown as Parameters<TerminalPilotRuntime["createSession"]>[0],
      envFromValue(params.envSession)
    );
    return formatNamedSession(namedSession);
  }

  if (request.method === "resolveSession") {
    const namedSession = await runtime.resolveSession(
      optionalString(params.name),
      envFromValue(params.envSession)
    );
    return formatNamedSession(namedSession);
  }

  if (request.method === "listSessions") {
    const sessions = await runtime.listSessions();
    return sessions.map(formatNamedSession);
  }

  if (request.method === "hasRetainedSessions") {
    return runtime.hasRetainedSessions();
  }

  if (request.method === "closeSession") {
    return runtime.closeSession(optionalString(params.name), envFromValue(params.envSession));
  }

  if (request.method === "sessionAction") {
    return runSessionAction(runtime, params);
  }

  if (request.method === "shutdown") {
    await runtime.close();
    process.exit(0);
  }

  throw new UserError(`Unknown terminal-pilot daemon method: ${request.method}`);
}

async function runSessionAction(
  runtime: TerminalPilotRuntime,
  params: Record<string, unknown>
): Promise<unknown> {
  const name = optionalString(params.name);
  const action = optionalString(params.action);
  const args = Array.isArray(params.args) ? params.args : [];
  const namedSession = await runtime.resolveSession(name);
  const session = namedSession.session;

  if (action === "fill") {
    await session.fill(String(args[0] ?? ""));
    return undefined;
  }
  if (action === "type") {
    await session.type(String(args[0] ?? ""));
    return undefined;
  }
  if (action === "press") {
    await session.press(String(args[0] ?? "") as TerminalKey);
    return undefined;
  }
  if (action === "signal") {
    await session.signal(String(args[0] ?? ""));
    return undefined;
  }
  if (action === "waitFor") {
    return session.waitFor(deserializePattern(args[0]), optionalRecord(args[1]));
  }
  if (action === "waitForExit") {
    return session.waitForExit(optionalRecord(args[0]));
  }
  if (action === "screen") {
    const screen = await session.screen();
    return {
      lines: [...screen.lines],
      rawLines: [...screen.rawLines],
      cursor: { ...screen.cursor },
      size: { ...screen.size }
    };
  }
  if (action === "history") {
    return session.history(optionalRecord(args[0]));
  }
  if (action === "resize") {
    await session.resize(Number(args[0]), Number(args[1]));
    return undefined;
  }

  throw new UserError(`Unknown terminal-pilot session action: ${action ?? "<missing>"}`);
}

async function ensureDaemon(): Promise<void> {
  try {
    await sendRequest("ping", undefined, 0, { start: false });
    return;
  } catch {
    // Start below.
  }

  const socketPath = resolveSocketPath(process.env);
  await mkdir(path.dirname(socketPath), { recursive: true });
  if (process.platform !== "win32") {
    await unlink(socketPath).catch(() => undefined);
  }

  const entryPoint = process.argv[1];
  if (typeof entryPoint !== "string" || entryPoint.length === 0) {
    throw new UserError("Cannot start terminal-pilot daemon: entrypoint is unknown.");
  }

  const child = spawn(process.execPath, [...process.execArgv, entryPoint, DAEMON_ARG], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();

  const startedAt = Date.now();
  while (Date.now() - startedAt <= START_TIMEOUT_MS) {
    try {
      await sendRequest("ping", undefined, 0, { start: false });
      return;
    } catch {
      await sleep(50);
    }
  }

  throw new UserError("Timed out waiting for terminal-pilot daemon to start.");
}

function sendRequest<T>(
  method: string,
  params: unknown,
  id: number,
  options: { start?: boolean } = {}
): Promise<T> {
  const socketPath = resolveSocketPath(process.env);
  return new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const request: RpcRequest = { id, method, params };
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = buffer.slice(0, newlineIndex);
      socket.end();
      try {
        const response = JSON.parse(line) as RpcResponse;
        if (response.ok) {
          resolve(response.result as T);
        } else {
          reject(new UserError(response.error.message));
        }
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      if (options.start === false) {
        reject(error);
        return;
      }
      reject(new UserError(error.message));
    });
  });
}

function resolveSocketPath(env: NodeJS.ProcessEnv): string {
  const runtimeDir =
    env[RUNTIME_DIR_ENV] ??
    path.join(os.tmpdir(), `terminal-pilot-${process.getuid?.() ?? "user"}`);

  if (process.platform === "win32") {
    const hash = createHash("sha256").update(runtimeDir).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\terminal-pilot-${hash}`;
  }

  return path.join(runtimeDir, "daemon.sock");
}

function formatNamedSession(
  namedSession: Awaited<ReturnType<TerminalPilotRuntime["resolveSession"]>>
) {
  return {
    name: namedSession.name,
    session: formatSession(namedSession.session)
  };
}

function formatSession(
  session: Pick<TerminalSession, "id" | "command" | "pid" | "exitCode">
): SessionInfo {
  return {
    id: session.id,
    command: session.command,
    pid: session.pid,
    exitCode: session.exitCode
  };
}

function envFromValue(value: unknown): HandlerEnvLike | undefined {
  const sessionName = optionalString(value);
  if (sessionName === undefined) {
    return undefined;
  }

  return {
    get(key: string): string | undefined {
      return key === SESSION_ENV_VAR ? sessionName : undefined;
    }
  };
}

function serializePattern(pattern: string | RegExp): unknown {
  if (typeof pattern === "string") {
    return { kind: "literal", value: pattern };
  }

  return { kind: "regex", source: pattern.source, flags: pattern.flags };
}

function deserializePattern(value: unknown): string | RegExp {
  if (!isRecord(value)) {
    return String(value ?? "");
  }
  if (value.kind === "regex") {
    return new RegExp(String(value.source ?? ""), String(value.flags ?? ""));
  }
  return String(value.value ?? "");
}

function optionalRecord(value: unknown): Record<string, never> | undefined {
  return isRecord(value) ? (value as Record<string, never>) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
