import { afterEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { AcpTransport } from "./acp-transport.js";
import { AcpClient, type AcpClientTerminalHandler } from "./acp-client.js";
import {
  extractMessagesFromSessionUpdateStream,
  extractToolCallSummariesFromSessionUpdateStream,
  extractUsageFromSessionUpdateStream,
} from "./stream-helpers.js";
import type {
  CreateTerminalRequest,
  InitializeResponse,
  KillTerminalCommandRequest,
  PermissionOptionKind,
  PromptResponse,
  ReadTextFileRequest,
  ReleaseTerminalRequest,
  RequestId,
  RequestPermissionOutcome,
  RequestPermissionRequest,
  SessionNotification,
  SessionUpdate,
  SessionUpdateNotification,
  TerminalOutputRequest,
  ToolCallUpdate,
  WaitForTerminalExitRequest,
  WriteTextFileRequest,
} from "./types.js";
import { PassThrough, Readable } from "node:stream";
import {
  JsonRpcMessageLayer,
  createJsonRpcErrorResponse,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcResponseMessage,
} from "./jsonrpc-message-layer.js";
import {
  ACP_ERROR_CODE_AUTH_REQUIRED,
  ACP_ERROR_CODE_INTERNAL,
  ACP_ERROR_CODE_INVALID_PARAMS,
  ACP_ERROR_CODE_INVALID_REQUEST,
  ACP_ERROR_CODE_METHOD_NOT_FOUND,
  ACP_ERROR_CODE_PARSE,
  ACP_ERROR_CODE_RESOURCE_NOT_FOUND,
  AcpError,
  isAcpError,
} from "./types.js";
import {
  formatRunReportSummary,
  formatSessionUpdate,
  generateRunReportFromSessionUpdateStream,
  mapLegacyEventToSessionUpdates,
  parseSessionUpdate,
  saveRunReport,
  type RunReport,
  type RunReportFileSystem,
  type ToolCallSummary,
} from "./index.js";

// ---------------------------------------------------------------------------
// acp-client.integration.test.ts — integration test with real subprocess
// ---------------------------------------------------------------------------

const MOCK_AGENT_SCRIPT = `
const readline = require("node:readline");

const lineReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let nextRequestId = 0;
const pendingRequests = new Map();

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function sendRequest(method, params) {
  const id = "agent-" + String(++nextRequestId);
  send({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });

  return new Promise((resolve, reject) => {
    pendingRequests.set(String(id), { resolve, reject });
  });
}

lineReader.on("line", (line) => {
  if (line.trim().length === 0) {
    return;
  }

  const message = JSON.parse(line);
  if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
    const pendingRequest = pendingRequests.get(String(message.id));
    if (!pendingRequest) {
      return;
    }

    pendingRequests.delete(String(message.id));
    if (message.error) {
      pendingRequest.reject(new Error(String(message.error.message)));
      return;
    }

    pendingRequest.resolve(message.result);
    return;
  }

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: false,
          },
        },
        agentInfo: {
          name: "mock-agent",
          version: process.env.ACP_CLIENT_TEST_FLAG || "missing-env",
        },
      },
    });
    return;
  }

  if (message.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessionId: "session-integration",
      },
    });
    return;
  }

  if (message.method === "session/prompt") {
    (async () => {
      const permissionResult = await sendRequest("session/request_permission", {
        sessionId: message.params.sessionId,
        toolCall: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          title: "Read context",
        },
        options: [
          {
            optionId: "allow-once",
            kind: "allow_once",
            name: "Allow once",
          },
        ],
      });

      const readFileResult = await sendRequest("fs/read_text_file", {
        sessionId: message.params.sessionId,
        path: "/workspace/notes.txt",
      });

      const terminalResult = await sendRequest("terminal/create", {
        sessionId: message.params.sessionId,
        command: "echo",
        args: ["integration"],
        cwd: "/workspace",
      });

      await sendRequest("terminal/release", {
        sessionId: message.params.sessionId,
        terminalId: terminalResult.terminalId,
      });

      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text:
                "permission=" +
                permissionResult.outcome.outcome +
                ";file=" +
                readFileResult.content +
                ";terminal=" +
                terminalResult.terminalId,
            },
          },
        },
      });

      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          stopReason: "completed",
        },
      });
    })().catch((error) => {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: String(error instanceof Error ? error.message : error),
        },
      });
    });
  }
});
`;

async function collectUpdates(
  turn: AsyncIterable<SessionUpdateNotification>
): Promise<SessionUpdateNotification[]> {
  const updates: SessionUpdateNotification[] = [];
  for await (const update of turn) {
    updates.push(update);
  }

  return updates;
}

describe("AcpClient integration", () => {
  it("runs full ACP lifecycle over a mock subprocess through the high-level facade", async () => {
    const permission = vi.fn(async () => ({ outcome: "selected" as const, optionId: "allow-once" }));
    const readTextFile = vi.fn(async () => "hello-from-client-fs");
    const terminalCreate = vi.fn(async () => "term-integration");
    const terminalRelease = vi.fn(async () => {});

    const client = new AcpClient({
      command: process.execPath,
      args: ["-e", MOCK_AGENT_SCRIPT],
      env: {
        ...process.env,
        ACP_CLIENT_TEST_FLAG: "from-client-env",
      },
      clientCapabilities: {
        fs: { readTextFile: true },
        terminal: true,
      },
      handlers: {
        permission,
        fs: {
          readTextFile,
        },
        terminal: {
          create: terminalCreate,
          output: async () => ({ output: "", truncated: false }),
          waitForExit: async () => ({ exitCode: 0 }),
          kill: async () => {},
          release: terminalRelease,
        },
      },
    });

    try {
      const initializeResult = await client.initialize();
      const session = await client.newSession("/workspace", []);
      const turn = client.prompt(session.sessionId, [{ type: "text", text: "hello" }]);
      const updatesPromise = collectUpdates(turn);
      const promptResult = await turn.response;
      const updates = await updatesPromise;

      expect(initializeResult.protocolVersion).toBe(1);
      expect(client.agentCapabilities).toMatchObject({ loadSession: true });
      expect(client.agentInfo).toEqual({ name: "mock-agent", version: "from-client-env" });
      expect(promptResult).toEqual({ stopReason: "completed" });
      expect(updates).toHaveLength(1);
      expect(updates[0]?.params.update).toEqual({
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text:
            "permission=selected;file=hello-from-client-fs;terminal=term-integration",
        },
      });
      expect(permission).toHaveBeenCalledTimes(1);
      expect(readTextFile).toHaveBeenCalledWith({
        sessionId: "session-integration",
        path: "/workspace/notes.txt",
        line: undefined,
        limit: undefined,
      });
      expect(terminalCreate).toHaveBeenCalledWith({
        sessionId: "session-integration",
        command: "echo",
        args: ["integration"],
        cwd: "/workspace",
        env: undefined,
        outputByteLimit: undefined,
      });
      expect(terminalRelease).toHaveBeenCalledWith({
        sessionId: "session-integration",
        terminalId: "term-integration",
      });
    } finally {
      await client.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// acp-client.test.ts — unit tests with TransportMock
// ---------------------------------------------------------------------------

interface TransportMock {
  transport: Pick<
    AcpTransport,
    "sendRequest" | "sendNotification" | "onRequest" | "onNotification"
  >;
  sendRequestMock: ReturnType<
    typeof vi.fn<
      (method: string, params?: unknown, options?: unknown) => Promise<unknown>
    >
  >;
  sendNotificationMock: ReturnType<typeof vi.fn<(method: string, params?: unknown) => void>>;
  onRequestMock: ReturnType<
    typeof vi.fn<
      (
        method: string,
        handler: (params: unknown, context: { id: RequestId; method: string }) => unknown
      ) => void
    >
  >;
  onNotificationMock: ReturnType<
    typeof vi.fn<
      (
        method: string,
        handler: (params: unknown, context: { method: string }) => void | Promise<void>
      ) => void
    >
  >;
  emitRequest: (
    method: string,
    params?: unknown,
    options?: { id?: RequestId }
  ) => Promise<unknown>;
  emitNotification: (method: string, params?: unknown) => Promise<void>;
}

interface PermissionHandlerArgs {
  toolCall: ToolCallUpdate;
  options: RequestPermissionRequest["options"];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  if (!resolve || !reject) {
    throw new Error("Failed to create deferred promise");
  }

  return {
    promise,
    resolve,
    reject,
  };
}

function createTransportMock(): TransportMock {
  const sendRequestMock = vi.fn<
    (method: string, params?: unknown, options?: unknown) => Promise<unknown>
  >();
  const sendNotificationMock = vi.fn<(method: string, params?: unknown) => void>();
  const requestHandlers = new Map<
    string,
    (params: unknown, context: { id: RequestId; method: string }) => unknown | Promise<unknown>
  >();
  const onRequestMock = vi.fn(
    (
      method: string,
      handler: (params: unknown, context: { id: RequestId; method: string }) => unknown
    ) => {
      requestHandlers.set(method, handler);
    }
  );
  const notificationHandlers = new Map<
    string,
    (params: unknown, context: { method: string }) => void | Promise<void>
  >();
  const onNotificationMock = vi.fn(
    (
      method: string,
      handler: (params: unknown, context: { method: string }) => void | Promise<void>
    ) => {
      notificationHandlers.set(method, handler);
    }
  );

  return {
    transport: {
      sendRequest: sendRequestMock as unknown as AcpTransport["sendRequest"],
      sendNotification: sendNotificationMock as unknown as AcpTransport["sendNotification"],
      onRequest: onRequestMock as unknown as AcpTransport["onRequest"],
      onNotification: onNotificationMock as unknown as AcpTransport["onNotification"],
    },
    sendRequestMock,
    sendNotificationMock,
    onRequestMock,
    onNotificationMock,
    emitRequest: async (
      method: string,
      params?: unknown,
      options: { id?: RequestId } = {}
    ): Promise<unknown> => {
      const handler = requestHandlers.get(method);
      if (!handler) {
        throw {
          code: -32601,
          message: `Method not found: "${method}"`,
        };
      }

      const id = options.id ?? 1;
      return handler(params, { id, method });
    },
    emitNotification: async (method: string, params?: unknown) => {
      const handler = notificationHandlers.get(method);
      if (!handler) {
        return;
      }

      await handler(params, { method });
    },
  };
}

function createMockChildProcess(): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & {
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };

  let closed = false;
  const emitClose = (code: number | null = 0, signal: NodeJS.Signals | null = null) => {
    if (closed) {
      return;
    }
    closed = true;
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("close", code, signal);
  };

  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>((signal) => {
    child.killed = true;
    emitClose(null, typeof signal === "string" ? signal : "SIGTERM");
    return true;
  });

  return child;
}

describe("AcpClient", () => {
  it("ignores inherited transports when process options provide a command", async () => {
    const inherited = createTransportMock();
    const child = createMockChildProcess();
    const spawn = vi.fn(() => child);

    const client = withObjectPrototypeProperties({ transport: inherited.transport }, () =>
      new AcpClient({
        command: "poe-agent",
        spawn
      })
    );

    await client.dispose();

    expect(spawn).toHaveBeenCalledWith(
      "poe-agent",
      [],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
    );
    expect(inherited.onRequestMock).not.toHaveBeenCalled();
    expect(inherited.onNotificationMock).not.toHaveBeenCalled();
  });

  it("sends initialize with client details and stores agent metadata", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    const initializeResponse: InitializeResponse = {
      protocolVersion: 2,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      agentInfo: { name: "poe-agent", version: "1.2.3" },
    };
    sendRequestMock.mockResolvedValueOnce(initializeResponse);

    const client = new AcpClient({
      transport,
      protocolVersion: 2,
      clientInfo: { name: "poe-code", version: "0.0.1" },
      clientCapabilities: { fs: { readTextFile: true }, terminal: true },
    });

    const negotiated = await client.initialize();

    expect(sendRequestMock).toHaveBeenCalledWith("initialize", {
      protocolVersion: 2,
      clientInfo: { name: "poe-code", version: "0.0.1" },
      clientCapabilities: { fs: { readTextFile: true }, terminal: true },
    });
    expect(negotiated).toEqual({
      protocolVersion: 2,
      agentCapabilities: initializeResponse.agentCapabilities,
      agentInfo: initializeResponse.agentInfo,
    });
    expect(client.state).toBe("ready");
    expect(client.negotiatedProtocolVersion).toBe(2);
    expect(client.agentCapabilities).toEqual(initializeResponse.agentCapabilities);
    expect(client.agentInfo).toEqual(initializeResponse.agentInfo);
    expect(client.authMethods).toEqual([]);
    expect(() => client.assertReady("session/new")).not.toThrow();
  });

  it("allows initialize-time client capabilities and wires handlers from them", async () => {
    const { transport, sendRequestMock, emitRequest, onRequestMock } = createTransportMock();
    const readTextFile = vi.fn(async () => "content-from-fs-handler");
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({
      transport,
      protocolVersion: 1,
      handlers: {
        fs: {
          readTextFile,
        },
      },
    });

    await client.initialize({
      fs: {
        readTextFile: true,
      },
    });

    expect(sendRequestMock).toHaveBeenCalledWith("initialize", {
      protocolVersion: 1,
      clientInfo: undefined,
      clientCapabilities: {
        fs: {
          readTextFile: true,
        },
      },
    });
    expect(onRequestMock).toHaveBeenCalledWith("fs/read_text_file", expect.any(Function));
    const response = await emitRequest("fs/read_text_file", {
      sessionId: "session-1",
      path: "/workspace/file.txt",
    } satisfies ReadTextFileRequest);
    expect(response).toEqual({ content: "content-from-fs-handler" });
  });

  it("does not serve capability requests before initialization completes", async () => {
    const { transport, sendRequestMock, emitRequest } = createTransportMock();
    const initializeResponse = createDeferred<InitializeResponse>();
    const readTextFile = vi.fn(async () => "secret");
    sendRequestMock.mockReturnValueOnce(initializeResponse.promise);
    const client = new AcpClient({
      transport,
      protocolVersion: 1,
      fsHandler: { readTextFile },
    });

    const initializing = client.initialize({ fs: { readTextFile: true } });

    await expect(
      emitRequest("fs/read_text_file", {
        sessionId: "session-1",
        path: "/workspace/file.txt",
      } satisfies ReadTextFileRequest)
    ).rejects.toMatchObject({ code: -32601 });
    expect(readTextFile).not.toHaveBeenCalled();

    initializeResponse.resolve({ protocolVersion: 1 });
    await initializing;
    await expect(
      emitRequest("fs/read_text_file", {
        sessionId: "session-1",
        path: "/workspace/file.txt",
      } satisfies ReadTextFileRequest)
    ).resolves.toEqual({ content: "secret" });
  });

  it("defaults protocolVersion to 1 when omitted", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({ transport });

    await client.initialize();

    expect(sendRequestMock).toHaveBeenCalledWith("initialize", {
      protocolVersion: 1,
      clientInfo: undefined,
      clientCapabilities: undefined,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid client protocol version %s before sending initialize",
    async (protocolVersion) => {
      const { transport, sendRequestMock } = createTransportMock();
      const client = new AcpClient({
        transport,
        protocolVersion,
      } as ConstructorParameters<typeof AcpClient>[0]);

      await expect(client.initialize()).rejects.toThrow("Client protocol version");
      expect(sendRequestMock).not.toHaveBeenCalled();
      expect(client.state).toBe("uninitialized");
    }
  );

  it("negotiates protocol version using the minimum of client and agent versions", async () => {
    const lower = createTransportMock();
    lower.sendRequestMock.mockResolvedValueOnce({ protocolVersion: 2 } satisfies InitializeResponse);
    const lowerVersionClient = new AcpClient({ transport: lower.transport, protocolVersion: 4 });

    await lowerVersionClient.initialize();

    expect(lowerVersionClient.negotiatedProtocolVersion).toBe(2);

    const higher = createTransportMock();
    higher.sendRequestMock.mockResolvedValueOnce({ protocolVersion: 9 } satisfies InitializeResponse);
    const higherVersionClient = new AcpClient({ transport: higher.transport, protocolVersion: 4 });

    await higherVersionClient.initialize();

    expect(higherVersionClient.negotiatedProtocolVersion).toBe(4);
  });

  it.each(["invalid", -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid agent protocol version %s without becoming ready",
    async (protocolVersion) => {
      const { transport, sendRequestMock } = createTransportMock();
      sendRequestMock.mockResolvedValueOnce({ protocolVersion } as unknown as InitializeResponse);
      const client = new AcpClient({ transport, protocolVersion: 1 });

      await expect(client.initialize()).rejects.toThrow(
        "Agent returned an invalid protocol version."
      );
      expect(client.state).toBe("uninitialized");
      expect(client.negotiatedProtocolVersion).toBeNull();
    }
  );

  it("rejects concurrent initialization before sending a second handshake", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    const initializeResponse = createDeferred<InitializeResponse>();
    sendRequestMock.mockReturnValueOnce(initializeResponse.promise);
    const client = new AcpClient({ transport, protocolVersion: 1 });

    const pendingInitialize = client.initialize();

    await expect(client.initialize()).rejects.toThrow("initialize() can only be called once.");
    expect(sendRequestMock).toHaveBeenCalledTimes(1);

    initializeResponse.resolve({ protocolVersion: 1 });
    await expect(pendingInitialize).resolves.toMatchObject({ protocolVersion: 1 });
  });

  it("requires authentication before becoming ready when auth methods are returned", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({
        protocolVersion: 1,
        authMethods: [
          { id: "oauth", name: "OAuth" },
          { id: "token", name: "Token" },
        ],
      } satisfies InitializeResponse)
      .mockResolvedValueOnce({});

    const client = new AcpClient({ transport, protocolVersion: 1 });

    await client.initialize();

    expect(client.state).toBe("initialized");
    expect(client.authMethods).toEqual([
      { id: "oauth", name: "OAuth" },
      { id: "token", name: "Token" },
    ]);
    expect(() => client.assertReady("session/new")).toThrow(
      'Cannot call "session/new" before authentication completes.'
    );

    await client.authenticate("oauth");

    expect(sendRequestMock).toHaveBeenNthCalledWith(2, "authenticate", {
      methodId: "oauth",
    });
    expect(client.state).toBe("ready");
    expect(() => client.assertReady("session/new")).not.toThrow();
  });

  it.each([
    ["string", "oauth"],
    ["missing id", [{ name: "OAuth" }]],
    ["non-string id", [{ id: 123, name: "OAuth" }]],
    ["missing name", [{ id: "oauth" }]],
    ["non-string name", [{ id: "oauth", name: 123 }]],
  ])("rejects invalid authMethods from initialize response: %s", async (_label, authMethods) => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({
      protocolVersion: 1,
      authMethods,
    } as unknown as InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });

    await expect(client.initialize()).rejects.toThrow(/authMethods/i);
    expect(client.state).toBe("uninitialized");
    expect(client.authMethods).toEqual([]);
  });

  it("rejects concurrent authentication before sending duplicate credentials", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    const authenticateResponse = createDeferred<Record<string, never>>();
    sendRequestMock
      .mockResolvedValueOnce({
        protocolVersion: 1,
        authMethods: [{ id: "oauth", name: "OAuth" }],
      } satisfies InitializeResponse)
      .mockReturnValueOnce(authenticateResponse.promise);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const pendingAuthenticate = client.authenticate("oauth");

    await expect(client.authenticate("oauth")).rejects.toThrow(
      "Authentication is already in progress."
    );
    expect(sendRequestMock).toHaveBeenCalledTimes(2);

    authenticateResponse.resolve({});
    await expect(pendingAuthenticate).resolves.toEqual({});
    expect(client.state).toBe("ready");
  });

  it("does not require authenticate when the agent returns no auth methods", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });

    await client.initialize();

    await expect(client.authenticate("oauth")).rejects.toThrow(
      "Authentication is not required for this agent."
    );
    expect(sendRequestMock).toHaveBeenCalledTimes(1);
  });

  it("skips auth enforcement when skipAuth is true", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({
        protocolVersion: 1,
        authMethods: [{ id: "oauth", name: "OAuth" }],
      } satisfies InitializeResponse)
      .mockResolvedValueOnce({ sessionId: "session-1" });

    const client = new AcpClient({ transport, protocolVersion: 1, skipAuth: true });

    await client.initialize();

    expect(client.state).toBe("ready");
    expect(client.authMethods).toEqual([{ id: "oauth", name: "OAuth" }]);
    expect(() => client.assertReady("session/new")).not.toThrow();
  });

  it("enforces lifecycle state violations", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({
        protocolVersion: 1,
        authMethods: [{ id: "oauth", name: "OAuth" }],
      } satisfies InitializeResponse)
      .mockResolvedValueOnce({});
    const client = new AcpClient({ transport, protocolVersion: 1 });

    expect(() => client.assertReady("session/new")).toThrow(
      'Cannot call "session/new" before initialize().'
    );
    await expect(client.authenticate("oauth")).rejects.toThrow(
      "Cannot authenticate before initialize()."
    );

    await client.initialize();

    await expect(client.initialize()).rejects.toThrow("initialize() can only be called once.");
    await expect(client.authenticate("unknown")).rejects.toThrow(
      'Unknown auth method "unknown".'
    );
  });

  it("creates a new session and returns session details", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({
        sessionId: "session-1",
        configOptions: [
          {
            type: "select",
            id: "model",
            name: "Model",
            currentValue: "sonnet",
            options: [{ value: "sonnet", name: "Sonnet" }],
          },
        ],
        modes: {
          availableModes: [{ id: "default", name: "Default" }],
          currentModeId: "default",
        },
      });
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const result = await client.newSession("/workspace", []);

    expect(sendRequestMock).toHaveBeenNthCalledWith(2, "session/new", {
      cwd: "/workspace",
      mcpServers: [],
    });
    expect(result).toEqual({
      sessionId: "session-1",
      configOptions: [
        {
          type: "select",
          id: "model",
          name: "Model",
          currentValue: "sonnet",
          options: [{ value: "sonnet", name: "Sonnet" }],
        },
      ],
      modes: {
        availableModes: [{ id: "default", name: "Default" }],
        currentModeId: "default",
      },
    });
  });

  it("rejects session/new responses with non-string session ids", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({ sessionId: 17 });
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    await expect(client.newSession("/workspace", [])).rejects.toThrow(
      'Invalid response from "session/new": "sessionId" must be a string.'
    );
  });

  it("supports creating multiple sessions over one connection", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockImplementation(async (method, params) => {
        if (method !== "session/new") {
          return {};
        }

        const { cwd } = params as { cwd: string };
        return {
          sessionId: cwd === "/workspace/a" ? "session-a" : "session-b",
        };
      });
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const [first, second] = await Promise.all([
      client.newSession("/workspace/a", []),
      client.newSession("/workspace/b", []),
    ]);

    expect(first).toEqual({ sessionId: "session-a" });
    expect(second).toEqual({ sessionId: "session-b" });
    expect(sendRequestMock).toHaveBeenCalledTimes(3);
  });

  it("loads an existing session when the agent supports loadSession", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true, sse: true },
        },
      } satisfies InitializeResponse)
      .mockResolvedValueOnce({
        configOptions: [
          {
            type: "select",
            id: "verbosity",
            name: "Verbosity",
            currentValue: "normal",
            options: [{ value: "normal", name: "Normal" }],
          },
        ],
        modes: {
          availableModes: [{ id: "code", name: "Code" }],
          currentModeId: "code",
        },
      });
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const result = await client.loadSession("session-1", "/workspace", [
      {
        name: "stdio-server",
        command: "node",
        args: ["server.js"],
        env: [],
      },
      {
        type: "http",
        name: "http-server",
        url: "https://example.com/mcp",
        headers: [],
      },
      {
        type: "sse",
        name: "sse-server",
        url: "https://example.com/sse",
        headers: [],
      },
    ]);

    expect(sendRequestMock).toHaveBeenNthCalledWith(2, "session/load", {
      sessionId: "session-1",
      cwd: "/workspace",
      mcpServers: [
        {
          name: "stdio-server",
          command: "node",
          args: ["server.js"],
          env: [],
        },
        {
          type: "http",
          name: "http-server",
          url: "https://example.com/mcp",
          headers: [],
        },
        {
          type: "sse",
          name: "sse-server",
          url: "https://example.com/sse",
          headers: [],
        },
      ],
    });
    expect(result).toEqual({
      configOptions: [
        {
          type: "select",
          id: "verbosity",
          name: "Verbosity",
          currentValue: "normal",
          options: [{ value: "normal", name: "Normal" }],
        },
      ],
      modes: {
        availableModes: [{ id: "code", name: "Code" }],
        currentModeId: "code",
      },
    });
  });

  it("rejects loadSession when the agent does not advertise loadSession support", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    await expect(client.loadSession("session-1", "/workspace", [])).rejects.toThrow(
      'Cannot call "session/load" because the agent does not support session loading.'
    );
    expect(sendRequestMock).toHaveBeenCalledTimes(1);
  });

  it("rejects MCP http servers when the agent does not support them", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    await expect(
      client.newSession("/workspace", [
        {
          type: "http",
          name: "http-server",
          url: "https://example.com/mcp",
          headers: [],
        },
      ])
    ).rejects.toThrow('Agent does not support MCP server type "http".');
    expect(sendRequestMock).toHaveBeenCalledTimes(1);
  });

  it("rejects MCP sse servers when the agent does not support them", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: false },
      },
    } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    await expect(
      client.loadSession("session-1", "/workspace", [
        {
          type: "sse",
          name: "sse-server",
          url: "https://example.com/sse",
          headers: [],
        },
      ])
    ).rejects.toThrow('Agent does not support MCP server type "sse".');
    expect(sendRequestMock).toHaveBeenCalledTimes(1);
  });

  it("sends session/cancel notifications", async () => {
    const { transport, sendRequestMock, sendNotificationMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    client.cancelSession("session-1");

    expect(sendNotificationMock).toHaveBeenCalledWith("session/cancel", {
      sessionId: "session-1",
    });
  });

  it("sends session/set_mode requests", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({});
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const result = await client.setMode("session-1", "code");

    expect(sendRequestMock).toHaveBeenNthCalledWith(2, "session/set_mode", {
      sessionId: "session-1",
      modeId: "code",
    });
    expect(result).toEqual({});
  });

  it("sends session/set_config_option requests and returns updated config options", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({
        configOptions: [
          {
            type: "select",
            id: "model",
            name: "Model",
            currentValue: "sonnet",
            options: [{ value: "sonnet", name: "Sonnet" }],
          },
          {
            type: "select",
            id: "verbosity",
            name: "Verbosity",
            currentValue: "high",
            options: [{ value: "high", name: "High" }],
          },
        ],
      });
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const result = await client.setConfigOption("session-1", "model", "sonnet");

    expect(sendRequestMock).toHaveBeenNthCalledWith(2, "session/set_config_option", {
      sessionId: "session-1",
      configId: "model",
      value: "sonnet",
    });
    expect(result).toEqual([
      {
        type: "select",
        id: "model",
        name: "Model",
        currentValue: "sonnet",
        options: [{ value: "sonnet", name: "Sonnet" }],
      },
      {
        type: "select",
        id: "verbosity",
        name: "Verbosity",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ]);
  });

  it("rejects session/set_config_option responses with non-array config options", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({ configOptions: 7 });
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    await expect(client.setConfigOption("session-1", "model", "sonnet")).rejects.toThrow(
      'Invalid response from "session/set_config_option": "configOptions" must be an array.'
    );
  });

  it("registers fs/read_text_file only when readTextFile capability is advertised", () => {
    const { transport, onRequestMock } = createTransportMock();
    const readTextFile = vi.fn(async () => "content");
    const writeTextFile = vi.fn(async () => {});
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: true,
        },
      },
      fsHandler: {
        readTextFile,
        writeTextFile,
      },
    });

    expect(onRequestMock).toHaveBeenCalledWith("session/request_permission", expect.any(Function));
    expect(onRequestMock).toHaveBeenCalledWith("fs/read_text_file", expect.any(Function));
    expect(onRequestMock).not.toHaveBeenCalledWith("fs/write_text_file", expect.any(Function));
  });

  it("handles fs/read_text_file requests through fsHandler using memfs", async () => {
    const { transport, emitRequest, onRequestMock } = createTransportMock();
    const volume = Volume.fromJSON(
      {
        "/workspace/notes.txt": "line-1\nline-2\nline-3\n",
      },
      "/"
    );
    const fs = createFsFromVolume(volume).promises;
    const readTextFile = vi.fn(
      async ({ path, line, limit }: { path: string; line?: number | null; limit?: number | null }) => {
        const content = await fs.readFile(path, "utf8");
        const lines = content.split("\n").filter((value) => value.length > 0);
        const start = line ? line - 1 : 0;
        const end = limit ? start + limit : lines.length;
        return lines.slice(start, end).join("\n");
      }
    );

    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: true,
        },
      },
      fsHandler: {
        readTextFile,
      },
    });

    expect(onRequestMock).toHaveBeenCalledWith("fs/read_text_file", expect.any(Function));

    const response = await emitRequest("fs/read_text_file", {
      sessionId: "session-1",
      path: "/workspace/notes.txt",
      line: 2,
      limit: 1,
    } satisfies ReadTextFileRequest);

    expect(readTextFile).toHaveBeenCalledWith({
      sessionId: "session-1",
      path: "/workspace/notes.txt",
      line: 2,
      limit: 1,
    });
    expect(response).toEqual({ content: "line-2" });
  });

  it("handles fs/write_text_file requests through fsHandler using memfs", async () => {
    const { transport, emitRequest, onRequestMock } = createTransportMock();
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    const writeTextFile = vi.fn(
      async ({ path, content }: { path: string; content: string }): Promise<void> => {
        await fs.mkdir("/workspace", { recursive: true });
        await fs.writeFile(path, content, "utf8");
      }
    );

    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          writeTextFile: true,
        },
      },
      fsHandler: {
        writeTextFile,
      },
    });

    expect(onRequestMock).toHaveBeenCalledWith("fs/write_text_file", expect.any(Function));

    const response = await emitRequest("fs/write_text_file", {
      sessionId: "session-1",
      path: "/workspace/output.txt",
      content: "written via handler",
    } satisfies WriteTextFileRequest);

    expect(writeTextFile).toHaveBeenCalledWith({
      sessionId: "session-1",
      path: "/workspace/output.txt",
      content: "written via handler",
    });
    await expect(fs.readFile("/workspace/output.txt", "utf8")).resolves.toBe("written via handler");
    expect(response).toEqual({});
  });

  it("returns invalid_params when fs/read_text_file path is relative", async () => {
    const { transport, emitRequest } = createTransportMock();
    const readTextFile = vi.fn(async () => "unused");
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true } },
      fsHandler: { readTextFile },
    });

    await expect(
      emitRequest("fs/read_text_file", {
        sessionId: "session-1",
        path: "workspace/file.txt",
      } satisfies ReadTextFileRequest)
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid params: "path" must be an absolute path',
    });
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("returns invalid_params when fs/write_text_file path is relative", async () => {
    const { transport, emitRequest } = createTransportMock();
    const writeTextFile = vi.fn(async () => {});
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { fs: { writeTextFile: true } },
      fsHandler: { writeTextFile },
    });

    await expect(
      emitRequest("fs/write_text_file", {
        sessionId: "session-1",
        path: "./output.txt",
        content: "x",
      } satisfies WriteTextFileRequest)
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid params: "path" must be an absolute path',
    });
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("returns invalid_params when fs/write_text_file content is not a string", async () => {
    const { transport, emitRequest } = createTransportMock();
    const writeTextFile = vi.fn(async () => {});
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { fs: { writeTextFile: true } },
      fsHandler: { writeTextFile },
    });

    await expect(
      emitRequest("fs/write_text_file", {
        sessionId: "session-1",
        path: "/workspace/output.txt",
        content: 123,
      } as unknown as WriteTextFileRequest)
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid params: "content" must be a string',
    });
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it.each([0, -1])("returns invalid_params when fs/read_text_file line is %d", async (line) => {
    const { transport, emitRequest } = createTransportMock();
    const readTextFile = vi.fn(async () => "unused");
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true } },
      fsHandler: { readTextFile },
    });

    await expect(
      emitRequest("fs/read_text_file", {
        sessionId: "session-1",
        path: "/workspace/file.txt",
        line,
      } satisfies ReadTextFileRequest)
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid params: "line" must be a 1-based integer',
    });
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.NaN])(
    "returns invalid_params when fs/read_text_file limit is %s",
    async (limit) => {
      const { transport, emitRequest } = createTransportMock();
      const readTextFile = vi.fn(async () => "unused");
      new AcpClient({
        transport,
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true } },
        fsHandler: { readTextFile },
      });

      await expect(
        emitRequest("fs/read_text_file", {
          sessionId: "session-1",
          path: "/workspace/file.txt",
          limit,
        } as ReadTextFileRequest)
      ).rejects.toMatchObject({
        code: -32602,
        message: 'Invalid params: "limit" must be a non-negative integer',
      });
      expect(readTextFile).not.toHaveBeenCalled();
    }
  );

  it("returns method_not_found when fs capability is not advertised", async () => {
    const { transport, emitRequest } = createTransportMock();
    new AcpClient({
      transport,
      protocolVersion: 1,
      fsHandler: {
        readTextFile: async () => "unused",
      },
    });

    await expect(
      emitRequest("fs/read_text_file", {
        sessionId: "session-1",
        path: "/workspace/file.txt",
      } satisfies ReadTextFileRequest)
    ).rejects.toMatchObject({
      code: -32601,
      message: 'Method not found: "fs/read_text_file"',
    });
  });

  it("registers terminal handlers only when terminal capability is advertised", () => {
    const { transport, onRequestMock } = createTransportMock();
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        terminal: true,
      },
      terminalHandler: {
        create: async () => "term-1",
        output: async () => ({ output: "", truncated: false }),
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => {},
        release: async () => {},
      },
    });

    expect(onRequestMock).toHaveBeenCalledWith("terminal/create", expect.any(Function));
    expect(onRequestMock).toHaveBeenCalledWith("terminal/output", expect.any(Function));
    expect(onRequestMock).toHaveBeenCalledWith(
      "terminal/wait_for_exit",
      expect.any(Function)
    );
    expect(onRequestMock).toHaveBeenCalledWith("terminal/kill", expect.any(Function));
    expect(onRequestMock).toHaveBeenCalledWith("terminal/release", expect.any(Function));
  });

  it("handles terminal/create requests through terminalHandler", async () => {
    const { transport, emitRequest, onRequestMock } = createTransportMock();
    const create = vi.fn(async () => "term-1");
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        terminal: true,
      },
      terminalHandler: {
        create,
        output: async () => ({ output: "", truncated: false }),
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => {},
        release: async () => {},
      },
    });

    expect(onRequestMock).toHaveBeenCalledWith("terminal/create", expect.any(Function));

    const response = await emitRequest("terminal/create", {
      sessionId: "session-1",
      command: "npm",
      args: ["run", "test"],
      cwd: "/workspace",
      env: [
        { name: "NODE_ENV", value: "test" },
        { name: "CI", value: "true" },
      ],
      outputByteLimit: 1024,
    } satisfies CreateTerminalRequest);

    expect(create).toHaveBeenCalledWith({
      sessionId: "session-1",
      command: "npm",
      args: ["run", "test"],
      cwd: "/workspace",
      env: [
        { name: "NODE_ENV", value: "test" },
        { name: "CI", value: "true" },
      ],
      outputByteLimit: 1024,
    });
    expect(response).toEqual({ terminalId: "term-1" });
  });

  it("rejects non-string terminal identifiers returned by terminal/create handlers", async () => {
    const { transport, emitRequest } = createTransportMock();
    const create = vi.fn(async () => 42);
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { terminal: true },
      terminalHandler: {
        create: create as unknown as AcpClientTerminalHandler["create"],
        output: async () => ({ output: "", truncated: false }),
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => {},
        release: async () => {},
      },
    });

    await expect(
      emitRequest("terminal/create", { sessionId: "session-1", command: "npm" })
    ).rejects.toThrow(/terminalId/i);
  });

  it("rejects duplicate terminal identifiers without losing the tracked terminal", async () => {
    const { transport, emitRequest } = createTransportMock();
    const output = vi.fn(async () => ({ output: "still alive", truncated: false }));
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: { terminal: true },
      terminalHandler: {
        create: async () => "shared-terminal",
        output,
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => {},
        release: async () => {},
      },
    });

    await emitRequest("terminal/create", { sessionId: "session-1", command: "first" });
    await expect(
      emitRequest("terminal/create", { sessionId: "session-1", command: "second" })
    ).rejects.toThrow('Terminal identifier "shared-terminal" is already active.');
    await expect(
      emitRequest("terminal/output", { sessionId: "session-1", terminalId: "shared-terminal" })
    ).resolves.toEqual({ output: "still alive", truncated: false });
    expect(output).toHaveBeenCalledOnce();
  });

  it.each([-1, 1.5, Number.NaN])(
    "returns invalid_params when terminal/create outputByteLimit is %s",
    async (outputByteLimit) => {
      const { transport, emitRequest } = createTransportMock();
      const create = vi.fn(async () => "term-1");
      new AcpClient({
        transport,
        protocolVersion: 1,
        clientCapabilities: { terminal: true },
        terminalHandler: {
          create,
          output: async () => ({ output: "", truncated: false }),
          waitForExit: async () => ({ exitCode: 0 }),
          kill: async () => {},
          release: async () => {},
        },
      });

      await expect(
        emitRequest("terminal/create", {
          sessionId: "session-1",
          command: "npm",
          outputByteLimit,
        } as CreateTerminalRequest)
      ).rejects.toMatchObject({
        code: -32602,
        message: 'Invalid params: "outputByteLimit" must be a non-negative integer',
      });
      expect(create).not.toHaveBeenCalled();
    }
  );

  it("handles terminal/output requests through terminalHandler", async () => {
    const { transport, emitRequest } = createTransportMock();
    const output = vi.fn(async () => ({
      output: "stdout",
      truncated: true,
      exitStatus: { exitCode: 1, signal: "SIGTERM" },
    }));
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        terminal: true,
      },
      terminalHandler: {
        create: async () => "term-1",
        output,
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => {},
        release: async () => {},
      },
    });

    await emitRequest("terminal/create", {
      sessionId: "session-1",
      command: "npm",
    } satisfies CreateTerminalRequest);

    const response = await emitRequest("terminal/output", {
      sessionId: "session-1",
      terminalId: "term-1",
    } satisfies TerminalOutputRequest);

    expect(output).toHaveBeenCalledWith({
      sessionId: "session-1",
      terminalId: "term-1",
    });
    expect(response).toEqual({
      output: "stdout",
      truncated: true,
      exitStatus: { exitCode: 1, signal: "SIGTERM" },
    });
  });

  it("handles terminal/wait_for_exit requests through terminalHandler", async () => {
    const { transport, emitRequest } = createTransportMock();
    const waitForExit = vi.fn(async () => ({ exitCode: 9, signal: null }));
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        terminal: true,
      },
      terminalHandler: {
        create: async () => "term-1",
        output: async () => ({ output: "", truncated: false }),
        waitForExit,
        kill: async () => {},
        release: async () => {},
      },
    });

    await emitRequest("terminal/create", {
      sessionId: "session-1",
      command: "npm",
    } satisfies CreateTerminalRequest);

    const response = await emitRequest("terminal/wait_for_exit", {
      sessionId: "session-1",
      terminalId: "term-1",
    } satisfies WaitForTerminalExitRequest);

    expect(waitForExit).toHaveBeenCalledWith({
      sessionId: "session-1",
      terminalId: "term-1",
    });
    expect(response).toEqual({ exitCode: 9, signal: null });
  });

  it("handles terminal/kill and terminal/release requests through terminalHandler", async () => {
    const { transport, emitRequest } = createTransportMock();
    const kill = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    new AcpClient({
      transport,
      protocolVersion: 1,
      clientCapabilities: {
        terminal: true,
      },
      terminalHandler: {
        create: async () => "term-1",
        output: async () => ({ output: "", truncated: false }),
        waitForExit: async () => ({ exitCode: 0 }),
        kill,
        release,
      },
    });

    await emitRequest("terminal/create", {
      sessionId: "session-1",
      command: "npm",
    } satisfies CreateTerminalRequest);

    const killResponse = await emitRequest("terminal/kill", {
      sessionId: "session-1",
      terminalId: "term-1",
    } satisfies KillTerminalCommandRequest);
    expect(kill).toHaveBeenCalledWith({
      sessionId: "session-1",
      terminalId: "term-1",
    });
    expect(killResponse).toEqual({});

    const releaseResponse = await emitRequest("terminal/release", {
      sessionId: "session-1",
      terminalId: "term-1",
    } satisfies ReleaseTerminalRequest);
    expect(release).toHaveBeenCalledWith({
      sessionId: "session-1",
      terminalId: "term-1",
    });
    expect(releaseResponse).toEqual({});
  });

  it("returns method_not_found when terminal capability is not advertised", async () => {
    const { transport, emitRequest } = createTransportMock();
    new AcpClient({
      transport,
      protocolVersion: 1,
      terminalHandler: {
        create: async () => "term-1",
        output: async () => ({ output: "", truncated: false }),
        waitForExit: async () => ({ exitCode: 0 }),
        kill: async () => {},
        release: async () => {},
      },
    });

    await expect(
      emitRequest("terminal/create", {
        sessionId: "session-1",
        command: "npm",
      } satisfies CreateTerminalRequest)
    ).rejects.toMatchObject({
      code: -32601,
      message: 'Method not found: "terminal/create"',
    });
  });

  it.each([
    {
      method: "terminal/output",
      params: {
        sessionId: "session-1",
        terminalId: "term-missing",
      } satisfies TerminalOutputRequest,
    },
    {
      method: "terminal/wait_for_exit",
      params: {
        sessionId: "session-1",
        terminalId: "term-missing",
      } satisfies WaitForTerminalExitRequest,
    },
    {
      method: "terminal/kill",
      params: {
        sessionId: "session-1",
        terminalId: "term-missing",
      } satisfies KillTerminalCommandRequest,
    },
    {
      method: "terminal/release",
      params: {
        sessionId: "session-1",
        terminalId: "term-missing",
      } satisfies ReleaseTerminalRequest,
    },
  ] as const)(
    "returns resource_not_found for unknown terminalId on %s",
    async ({ method, params }) => {
      const { transport, emitRequest } = createTransportMock();
      new AcpClient({
        transport,
        protocolVersion: 1,
        clientCapabilities: { terminal: true },
        terminalHandler: {
          create: async () => "term-1",
          output: async () => ({ output: "", truncated: false }),
          waitForExit: async () => ({ exitCode: 0 }),
          kill: async () => {},
          release: async () => {},
        },
      });

      await expect(emitRequest(method, params)).rejects.toMatchObject({
        code: -32002,
        message: 'Resource not found: terminal "term-missing"',
      });
    }
  );

  it.each([
    "allow_once",
    "allow_always",
    "reject_once",
    "reject_always",
  ] as const satisfies PermissionOptionKind[])(
    "handles permission requests for option kind %s",
    async (kind) => {
      const { transport, emitRequest, onRequestMock } = createTransportMock();
      const toolCall = {
        sessionUpdate: "tool_call_update" as const,
        toolCallId: "tool-1",
        title: "Run shell command",
      };
      const options = [
        {
          optionId: `${kind}-id`,
          kind,
          name: `Option for ${kind}`,
        },
      ];
      const permissionHandler = vi.fn(
        async ({
          toolCall: callbackToolCall,
          options: callbackOptions,
        }: PermissionHandlerArgs): Promise<RequestPermissionOutcome> => {
          expect(callbackToolCall).toEqual(toolCall);
          expect(callbackOptions).toEqual(options);
          return { outcome: "selected", optionId: `${kind}-id` };
        }
      );

      const client = new AcpClient({ transport, protocolVersion: 1, permissionHandler });

      expect(client).toBeInstanceOf(AcpClient);
      expect(onRequestMock).toHaveBeenCalledWith(
        "session/request_permission",
        expect.any(Function)
      );

      const response = await emitRequest("session/request_permission", {
        sessionId: "session-1",
        toolCall,
        options,
      } satisfies RequestPermissionRequest);

      expect(permissionHandler).toHaveBeenCalledWith({
        toolCall,
        options,
      });
      expect(response).toEqual({
        outcome: { outcome: "selected", optionId: `${kind}-id` },
      });
    }
  );

  it("returns cancelled outcome when permission handler returns cancelled", async () => {
    const { transport, emitRequest } = createTransportMock();
    const permissionHandler = vi.fn(
      async (): Promise<RequestPermissionOutcome> => ({ outcome: "cancelled" })
    );

    new AcpClient({ transport, protocolVersion: 1, permissionHandler });

    const response = await emitRequest("session/request_permission", {
      sessionId: "session-1",
      toolCall: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        title: "Edit file",
      },
      options: [
        {
          optionId: "allow",
          kind: "allow_once",
          name: "Allow once",
        },
      ],
    } satisfies RequestPermissionRequest);

    expect(permissionHandler).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("defaults permission requests to cancelled when no handler is provided", async () => {
    const { transport, emitRequest } = createTransportMock();
    new AcpClient({ transport, protocolVersion: 1 });

    const response = await emitRequest("session/request_permission", {
      sessionId: "session-1",
      toolCall: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        title: "Delete file",
      },
      options: [
        {
          optionId: "reject",
          kind: "reject_once",
          name: "Reject once",
        },
      ],
    } satisfies RequestPermissionRequest);

    expect(response).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("auto-approves permission requests when autoApprove is true", async () => {
    const { transport, emitRequest } = createTransportMock();
    new AcpClient({ transport, protocolVersion: 1, autoApprove: true });

    const response = await emitRequest("session/request_permission", {
      sessionId: "session-1",
      toolCall: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        title: "Run MCP tool",
      },
      options: [
        { optionId: "reject", kind: "reject_once", name: "Reject" },
        { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
        { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
      ],
    } satisfies RequestPermissionRequest);

    expect(response).toEqual({ outcome: { outcome: "selected", optionId: "allow-always" } });
  });

  it("falls back to cancelled when autoApprove is true but no allow option exists", async () => {
    const { transport, emitRequest } = createTransportMock();
    new AcpClient({ transport, protocolVersion: 1, autoApprove: true });

    const response = await emitRequest("session/request_permission", {
      sessionId: "session-1",
      toolCall: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        title: "Dangerous action",
      },
      options: [
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ],
    } satisfies RequestPermissionRequest);

    expect(response).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("returns invalid_params when autoApprove receives malformed options", async () => {
    const { transport, emitRequest } = createTransportMock();
    new AcpClient({ transport, protocolVersion: 1, autoApprove: true });

    await expect(
      emitRequest("session/request_permission", {
        sessionId: "session-1",
        toolCall: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "pending",
        },
        options: 7,
      } as unknown as RequestPermissionRequest)
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid params: "options" must be an array',
    });
  });

  it("sends session/prompt, streams session/update notifications, and resolves stopReason", async () => {
    const { transport, sendRequestMock, emitNotification, onNotificationMock } =
      createTransportMock();
    const promptResponse = createDeferred<PromptResponse>();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockImplementationOnce(async () => promptResponse.promise);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const prompt = [{ type: "text", text: "Hello agent" }] as const;
    const turn = client.prompt("session-1", [...prompt]);
    const iterator = turn[Symbol.asyncIterator]();
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello user" },
    };

    await emitNotification("session/update", {
      sessionId: "session-1",
      update,
    } satisfies SessionNotification);

    expect(onNotificationMock).toHaveBeenCalledWith("session/update", expect.any(Function));
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "session-1", update },
      },
    });

    promptResponse.resolve({ stopReason: "completed" });

    await expect(turn.response).resolves.toEqual({ stopReason: "completed" });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(sendRequestMock).toHaveBeenNthCalledWith(2, "session/prompt", {
      sessionId: "session-1",
      prompt: [...prompt],
    });
  });

  it("accepts ACP end_turn prompt responses", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({ stopReason: "end_turn" } satisfies PromptResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const turn = client.prompt("session-1", [{ type: "text", text: "Hello agent" }]);

    await expect(turn.response).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("rejects prompt responses with invalid stopReason values", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({ stopReason: "totally-not-valid" } as unknown as PromptResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const turn = client.prompt("session-1", [{ type: "text", text: "Hello agent" }]);

    await expect(turn.response).rejects.toThrow(/stopReason/i);
  });

  it("validates prompt content using promptCapabilities", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    expect(() =>
      client.prompt("session-1", [{ type: "image", data: "Zm9v", mimeType: "image/png" }])
    ).toThrow('Agent does not support prompt content type "image".');
    expect(() =>
      client.prompt("session-1", [{ type: "audio", data: "YmFy", mimeType: "audio/mp3" }])
    ).toThrow('Agent does not support prompt content type "audio".');
    expect(() =>
      client.prompt("session-1", [
        {
          type: "resource",
          resource: {
            text: "context",
            uri: "file:///context.md",
          },
        },
      ])
    ).toThrow('Agent does not support prompt content type "resource".');
    expect(sendRequestMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose mutable agent capabilities used for prompt validation", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: { promptCapabilities: { image: false } },
    } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    client.agentCapabilities!.promptCapabilities!.image = true;

    expect(() =>
      client.prompt("session-1", [{ type: "image", data: "Zm9v", mimeType: "image/png" }])
    ).toThrow('Agent does not support prompt content type "image".');
    expect(sendRequestMock).toHaveBeenCalledTimes(1);
  });

  it("supports text and resource_link prompt content without extra capabilities", async () => {
    const { transport, sendRequestMock } = createTransportMock();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockResolvedValueOnce({ stopReason: "completed" } satisfies PromptResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const turn = client.prompt("session-1", [
      { type: "text", text: "Summarize this" },
      {
        type: "resource_link",
        name: "README",
        uri: "file:///workspace/README.md",
      },
    ]);

    await expect(turn.response).resolves.toEqual({ stopReason: "completed" });
  });

  it("routes interleaved session updates to the matching prompt session", async () => {
    const { transport, sendRequestMock, emitNotification } = createTransportMock();
    const responseBySession = new Map<string, Deferred<PromptResponse>>([
      ["session-a", createDeferred<PromptResponse>()],
      ["session-b", createDeferred<PromptResponse>()],
    ]);

    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockImplementation(async (method, params) => {
        if (method !== "session/prompt") {
          return {};
        }

        const sessionId = (params as { sessionId: string }).sessionId;
        const deferred = responseBySession.get(sessionId);
        if (!deferred) {
          throw new Error(`Unexpected session id: ${sessionId}`);
        }

        return deferred.promise;
      });

    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const turnA = client.prompt("session-a", [{ type: "text", text: "Prompt A" }]);
    const turnB = client.prompt("session-b", [{ type: "text", text: "Prompt B" }]);
    const iteratorA = turnA[Symbol.asyncIterator]();
    const iteratorB = turnB[Symbol.asyncIterator]();

    const updateA1: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "A1" },
    };
    const updateB1: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "B1" },
    };
    const updateA2: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 7,
      size: 20,
    };
    const updateA3: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "A3" },
    };

    await emitNotification("session/update", {
      sessionId: "session-a",
      update: updateA1,
    } satisfies SessionNotification);
    await emitNotification("session/update", {
      sessionId: "session-b",
      update: updateB1,
    } satisfies SessionNotification);
    await emitNotification("session/update", {
      sessionId: "session-a",
      update: updateA2,
    } satisfies SessionNotification);

    await expect(iteratorA.next()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "session-a", update: updateA1 },
      },
    });
    await expect(iteratorA.next()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "session-a", update: updateA2 },
      },
    });
    await expect(iteratorB.next()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "session-b", update: updateB1 },
      },
    });

    responseBySession.get("session-b")?.resolve({ stopReason: "cancelled" });
    await expect(turnB.response).resolves.toEqual({ stopReason: "cancelled" });
    await expect(iteratorB.next()).resolves.toEqual({ done: true, value: undefined });

    await emitNotification("session/update", {
      sessionId: "session-a",
      update: updateA3,
    } satisfies SessionNotification);
    await expect(iteratorA.next()).resolves.toEqual({
      done: false,
      value: {
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "session-a", update: updateA3 },
      },
    });

    responseBySession.get("session-a")?.resolve({ stopReason: "max_tokens" });
    await expect(turnA.response).resolves.toEqual({ stopReason: "max_tokens" });
    await expect(iteratorA.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("is compatible with existing v1 stream helpers", async () => {
    const { transport, sendRequestMock, emitNotification } = createTransportMock();
    const messagesResponse = createDeferred<PromptResponse>();
    const usageResponse = createDeferred<PromptResponse>();
    const toolResponse = createDeferred<PromptResponse>();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockImplementationOnce(async () => messagesResponse.promise)
      .mockImplementationOnce(async () => usageResponse.promise)
      .mockImplementationOnce(async () => toolResponse.promise);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();

    const messageTurn = client.prompt("session-messages", [
      { type: "text", text: "Message stream" },
    ]);
    const extractedMessagesPromise = extractMessagesFromSessionUpdateStream(messageTurn);
    await emitNotification("session/update", {
      sessionId: "session-messages",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Message 1" },
      },
    } satisfies SessionNotification);
    messagesResponse.resolve({ stopReason: "completed" });
    await expect(extractedMessagesPromise).resolves.toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Message 1" },
      },
    ]);
    await expect(messageTurn.response).resolves.toEqual({ stopReason: "completed" });

    const usageTurn = client.prompt("session-usage", [{ type: "text", text: "Usage stream" }]);
    const extractedUsagePromise = extractUsageFromSessionUpdateStream(usageTurn);
    await emitNotification("session/update", {
      sessionId: "session-usage",
      update: {
        sessionUpdate: "usage_update",
        used: 11,
        size: 50,
      },
    } satisfies SessionNotification);
    usageResponse.resolve({ stopReason: "completed" });
    await expect(extractedUsagePromise).resolves.toEqual([
      {
        sessionUpdate: "usage_update",
        used: 11,
        size: 50,
      },
    ]);
    await expect(usageTurn.response).resolves.toEqual({ stopReason: "completed" });

    const toolTurn = client.prompt("session-tools", [{ type: "text", text: "Tool stream" }]);
    const extractedToolCallsPromise =
      extractToolCallSummariesFromSessionUpdateStream(toolTurn);
    await emitNotification("session/update", {
      sessionId: "session-tools",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Run checks",
        kind: "execute",
        status: "pending",
      },
    } satisfies SessionNotification);
    await emitNotification("session/update", {
      sessionId: "session-tools",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
      },
    } satisfies SessionNotification);
    toolResponse.resolve({ stopReason: "completed" });
    await expect(extractedToolCallsPromise).resolves.toEqual([
      {
        toolCallId: "tool-1",
        title: "Run checks",
        kind: "execute",
        status: "completed",
      },
    ]);
    await expect(toolTurn.response).resolves.toEqual({ stopReason: "completed" });
  });

  it("supports underscore-prefixed extension methods", async () => {
    const { transport, sendRequestMock, sendNotificationMock, onRequestMock, onNotificationMock } =
      createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ ok: true });
    const client = new AcpClient({ transport, protocolVersion: 1 });

    const response = await client.sendExtRequest<{ ok: boolean }>("_custom/ping", {
      value: 9,
    });
    await client.sendExtNotification("_custom/note", { value: 5 });
    client.onExtRequest("_custom/request", async () => ({ accepted: true }));
    client.onExtNotification("_custom/event", async () => {});

    expect(response).toEqual({ ok: true });
    expect(sendRequestMock).toHaveBeenCalledWith("_custom/ping", { value: 9 }, {});
    expect(sendNotificationMock).toHaveBeenCalledWith("_custom/note", { value: 5 });
    expect(onRequestMock).toHaveBeenCalledWith("_custom/request", expect.any(Function));
    expect(onNotificationMock).toHaveBeenCalledWith("_custom/event", expect.any(Function));
  });

  it("rejects extension methods that are not underscore-prefixed", async () => {
    const { transport } = createTransportMock();
    const client = new AcpClient({ transport, protocolVersion: 1 });

    await expect(client.sendExtRequest("session/new", { cwd: "/workspace" })).rejects.toThrow(
      'Extension method must start with "_"'
    );
    await expect(client.sendExtNotification("session/cancel", { sessionId: "s-1" })).rejects.toThrow(
      'Extension method must start with "_"'
    );
    expect(() => client.onExtRequest("session/new", async () => ({}))).toThrow(
      'Extension method must start with "_"'
    );
    expect(() => client.onExtNotification("session/update", async () => {})).toThrow(
      'Extension method must start with "_"'
    );
  });

  it("disposes the transport and waits for close when available", async () => {
    const close = createDeferred<void>();
    const dispose = vi.fn(() => {
      close.resolve();
    });
    const transport = {
      sendRequest: vi.fn(async () => ({ protocolVersion: 1 })),
      sendNotification: vi.fn(),
      onRequest: vi.fn(),
      onNotification: vi.fn(),
      dispose,
      closed: close.promise,
    };

    const client = new AcpClient({
      transport: transport as unknown as Pick<
        AcpTransport,
        "sendRequest" | "sendNotification" | "onRequest" | "onNotification"
      >,
      protocolVersion: 1,
    });

    await client.dispose();
    await client.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("retries transport disposal after a transient dispose failure", async () => {
    const dispose = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("dispose temporarily failed");
      })
      .mockImplementationOnce(() => undefined);
    const client = new AcpClient({
      transport: {
        sendRequest: vi.fn(),
        sendNotification: vi.fn(),
        onRequest: vi.fn(),
        onNotification: vi.fn(),
        dispose,
      },
    });

    await expect(client.dispose()).rejects.toThrow("dispose temporarily failed");
    await expect(client.dispose()).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("rejects protocol operations after disposal without reaching the transport", async () => {
    const { transport, sendRequestMock, sendNotificationMock, onRequestMock } =
      createTransportMock();
    sendRequestMock.mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();
    await client.dispose();
    sendRequestMock.mockClear();
    sendNotificationMock.mockClear();
    onRequestMock.mockClear();

    await expect(client.newSession("/workspace", [])).rejects.toThrow("ACP client disposed.");
    expect(() => client.prompt("session-1", [{ type: "text", text: "hi" }])).toThrow(
      "ACP client disposed."
    );
    await expect(client.sendExtRequest("_custom/ping")).rejects.toThrow("ACP client disposed.");
    await expect(client.sendExtNotification("_custom/note")).rejects.toThrow(
      "ACP client disposed."
    );
    expect(() => client.onExtRequest("_custom/request", async () => ({}))).toThrow(
      "ACP client disposed."
    );
    expect(sendRequestMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(onRequestMock).not.toHaveBeenCalled();
  });

  it("ignores malformed native usage notifications during an active prompt", async () => {
    const { transport, sendRequestMock, emitNotification } = createTransportMock();
    const promptResponse = createDeferred<PromptResponse>();
    sendRequestMock
      .mockResolvedValueOnce({ protocolVersion: 1 } satisfies InitializeResponse)
      .mockReturnValueOnce(promptResponse.promise);
    const client = new AcpClient({ transport, protocolVersion: 1 });
    await client.initialize();
    const turn = client.prompt("session-1", [{ type: "text", text: "hello" }]);
    const updates = turn[Symbol.asyncIterator]();

    await emitNotification("session/update", {
      sessionId: "session-1",
      update: { sessionUpdate: "usage_update", used: "many", size: 50 },
    });
    await emitNotification("session/update", {
      sessionId: "session-1",
      update: { sessionUpdate: "usage_update", used: 10, size: 50 },
    });

    await expect(updates.next()).resolves.toMatchObject({
      value: {
        params: { update: { sessionUpdate: "usage_update", used: 10, size: 50 } },
      },
    });
    promptResponse.resolve({ stopReason: "completed" });
    await turn.response;
  });
});

// ---------------------------------------------------------------------------
// Shared harness (unified from acp-error.test.ts and jsonrpc-message-layer.test.ts)
// The more flexible version with optional options is used.
// ---------------------------------------------------------------------------

interface Harness {
  input: PassThrough;
  output: PassThrough;
  written: string[];
  layer: JsonRpcMessageLayer;
}

const cleanup: Array<() => void> = [];

afterEach(() => {
  vi.useRealTimers();
  while (cleanup.length > 0) {
    const fn = cleanup.pop();
    fn?.();
  }
});

function createHarness(options?: ConstructorParameters<typeof JsonRpcMessageLayer>[0]): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];

  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    written.push(String(chunk));
  });

  const layer = new JsonRpcMessageLayer({
    input,
    output,
    ...options,
  });

  cleanup.push(() => {
    layer.dispose();
    input.destroy();
    output.destroy();
  });

  return { input, output, written, layer };
}

function parseWrittenMessages(written: string[]): unknown[] {
  const combined = written.join("");
  if (combined.length === 0) {
    return [];
  }

  return combined
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

async function waitForWriteCount(written: string[], count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(parseWrittenMessages(written)).toHaveLength(count);
  });
}

// ---------------------------------------------------------------------------
// acp-error.test.ts — AcpError class and JSON-RPC AcpError handling
// ---------------------------------------------------------------------------

describe("AcpError", () => {
  it("defines all standard ACP error code constants", () => {
    expect(ACP_ERROR_CODE_PARSE).toBe(-32700);
    expect(ACP_ERROR_CODE_INVALID_REQUEST).toBe(-32600);
    expect(ACP_ERROR_CODE_METHOD_NOT_FOUND).toBe(-32601);
    expect(ACP_ERROR_CODE_INVALID_PARAMS).toBe(-32602);
    expect(ACP_ERROR_CODE_INTERNAL).toBe(-32603);
    expect(ACP_ERROR_CODE_AUTH_REQUIRED).toBe(-32000);
    expect(ACP_ERROR_CODE_RESOURCE_NOT_FOUND).toBe(-32002);
  });

  it("extends Error and carries code/message/data", () => {
    const error = new AcpError(ACP_ERROR_CODE_INVALID_PARAMS, "Invalid params", {
      field: "path",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AcpError);
    expect(error.name).toBe("AcpError");
    expect(error.code).toBe(ACP_ERROR_CODE_INVALID_PARAMS);
    expect(error.message).toBe("Invalid params");
    expect(error.data).toEqual({ field: "path" });
  });

  it("provides an isAcpError guard for class instances and plain error-like objects", () => {
    const instance = new AcpError(ACP_ERROR_CODE_AUTH_REQUIRED, "Auth required");

    expect(isAcpError(instance)).toBe(true);
    expect(
      isAcpError({
        code: -32000,
        message: "Auth required",
        data: { methodId: "api-key" },
      })
    ).toBe(true);
    expect(isAcpError({ code: 4_000_000_000, message: "bad" })).toBe(false);
    expect(isAcpError({ code: -32000 })).toBe(false);
    expect(isAcpError("nope")).toBe(false);
  });
});

describe("JSON-RPC AcpError handling", () => {
  it.each([
    ACP_ERROR_CODE_PARSE,
    ACP_ERROR_CODE_INVALID_REQUEST,
    ACP_ERROR_CODE_METHOD_NOT_FOUND,
    ACP_ERROR_CODE_INVALID_PARAMS,
    ACP_ERROR_CODE_INTERNAL,
    ACP_ERROR_CODE_AUTH_REQUIRED,
    ACP_ERROR_CODE_RESOURCE_NOT_FOUND,
  ] as const)(
    "wraps thrown AcpError (%d) into JSON-RPC error responses",
    async (code) => {
      const { input, written, layer } = createHarness();

      layer.onRequest("failing/method", () => {
        throw new AcpError(code, `error ${code}`, { marker: code });
      });

      input.write('{"jsonrpc":"2.0","id":1,"method":"failing/method","params":{}}\n');

      await waitForWriteCount(written, 1);
      const [response] = parseWrittenMessages(written) as Array<{
        error: { code: number; message: string; data: { marker: number } };
      }>;

      expect(response.error).toEqual({
        code,
        message: `error ${code}`,
        data: { marker: code },
      });
    }
  );

  it("parses incoming JSON-RPC errors into AcpError instances", async () => {
    const { input, written, layer } = createHarness();

    const pending = layer.sendRequest("auth/check", { token: "x" });

    await waitForWriteCount(written, 1);
    const [outbound] = parseWrittenMessages(written) as Array<{ id: number | string | null }>;
    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        error: {
          code: ACP_ERROR_CODE_AUTH_REQUIRED,
          message: "Auth required",
          data: { methodId: "api-key" },
        },
      }) + "\n"
    );

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AcpError);
    expect(error).toMatchObject({
      code: ACP_ERROR_CODE_AUTH_REQUIRED,
      message: "Auth required",
      data: { methodId: "api-key" },
    });
  });

  it("supports custom int32 error codes for serialization and deserialization", async () => {
    const customCode = 10_001;
    const serialized = createJsonRpcErrorResponse(
      "custom",
      new AcpError(customCode, "Custom failure", { retryable: false })
    );

    expect(serialized).toEqual({
      jsonrpc: "2.0",
      id: "custom",
      error: {
        code: customCode,
        message: "Custom failure",
        data: { retryable: false },
      },
    });

    const { input, written, layer } = createHarness();
    const pending = layer.sendRequest("custom/method");

    await waitForWriteCount(written, 1);
    const [outbound] = parseWrittenMessages(written) as Array<{ id: number | string | null }>;

    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: outbound.id,
        error: {
          code: customCode,
          message: "Custom failure",
          data: { retryable: false },
        },
      }) + "\n"
    );

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AcpError);
    expect(error).toMatchObject({
      code: customCode,
      message: "Custom failure",
      data: { retryable: false },
    });
  });
});

// ---------------------------------------------------------------------------
// jsonrpc-message-layer.test.ts — parseJsonRpcMessage, serializeJsonRpcMessage, JsonRpcMessageLayer
// ---------------------------------------------------------------------------

describe("parseJsonRpcMessage", () => {
  it("distinguishes request, notification, and response messages", () => {
    const request = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":1,"method":"tools/run","params":{"name":"fmt"}}'
    );
    const notification = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","method":"session/update","params":{"ok":true}}'
    );
    const response = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"req-1","result":{"done":true}}'
    );

    expect(request).toEqual({
      type: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/run",
        params: { name: "fmt" },
      },
    });

    expect(notification).toEqual({
      type: "notification",
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: { ok: true },
      },
    });

    expect(response).toEqual({
      type: "response",
      message: {
        jsonrpc: "2.0",
        id: "req-1",
        result: { done: true },
      },
    });
  });

  it("supports all RequestId variants", () => {
    const numberId = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":9,"method":"ping"}'
    );
    const stringId = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":"abc","method":"ping"}'
    );
    const nullId = parseJsonRpcMessage(
      '{"jsonrpc":"2.0","id":null,"method":"ping"}'
    );

    expect(numberId).toMatchObject({ type: "request", message: { id: 9 } });
    expect(stringId).toMatchObject({ type: "request", message: { id: "abc" } });
    expect(nullId).toMatchObject({ type: "request", message: { id: null } });
  });

  it("rejects non-finite numeric request ids before writing requests", () => {
    const { written, layer } = createHarness();

    expect(() => layer.sendRequest("ping", undefined, { id: Number.NaN })).toThrow(
      "Request id must be null, a string, or a safe integer"
    );
    expect(layer.pendingRequestCount()).toBe(0);
    expect(written).toEqual([]);
  });

  it("returns parse error metadata for malformed JSON", () => {
    const parsed = parseJsonRpcMessage("{broken");

    expect(parsed).toMatchObject({
      type: "invalid",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
    expect(parsed.type).toBe("invalid");
    if (parsed.type === "invalid") {
      expect(parsed.error).toBeInstanceOf(AcpError);
    }
  });
});

describe("serializeJsonRpcMessage", () => {
  it("serializes outgoing messages with newline delimiter", () => {
    const line = serializeJsonRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s-1" },
    });

    expect(line).toBe('{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-1"}}\n');
    expect(line.endsWith("\n")).toBe(true);
  });
});

describe("JsonRpcMessageLayer", () => {
  it("rejects fractional generated request ids", () => {
    const input = new PassThrough();
    const output = new PassThrough();

    expect(() => new JsonRpcMessageLayer({ input, output, firstRequestId: 1.5 })).toThrow(
      /firstRequestId/i
    );

    input.destroy();
    output.destroy();
  });

  it("parses newline-delimited input and dispatches request and notification handlers", async () => {
    const { input, written, layer } = createHarness();

    const requestHandler = vi.fn((params: unknown) => params);
    const notificationHandler = vi.fn();

    layer.onRequest("echo", requestHandler);
    layer.onNotification("note", notificationHandler);

    input.write('{"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":"hel');
    input.write('lo"}}\n{"jsonrpc":"2.0","method":"note","params":{"ok":true}}\n');

    await vi.waitFor(() => {
      expect(requestHandler).toHaveBeenCalledTimes(1);
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { text: "hello" },
    });
  });

  it("preserves UTF-8 values split across binary input chunks", async () => {
    const output = new PassThrough();
    const written: string[] = [];
    output.setEncoding("utf8");
    output.on("data", (chunk) => { written.push(String(chunk)); });
    const requestHandler = vi.fn((params: unknown) => params);
    const message = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":"🧪"}}\n', "utf8");
    const marker = Buffer.from("🧪", "utf8");
    const splitAt = message.indexOf(marker) + 2;
    const input = Readable.from([message.subarray(0, splitAt), message.subarray(splitAt)]);
    const layer = new JsonRpcMessageLayer({ input, output });
    layer.onRequest("echo", requestHandler);

    await waitForWriteCount(written, 1);
    expect(requestHandler).toHaveBeenCalledWith({ text: "🧪" }, { id: 1, method: "echo" });
  });

  it("processes responses while notification handlers are still pending", async () => {
    const { input, written, layer } = createHarness();
    let releaseNotification!: () => void;
    const pendingNotification = new Promise<void>((resolve) => { releaseNotification = resolve; });
    layer.onNotification("slow", async () => await pendingNotification);

    const request = layer.sendRequest("lookup");
    await waitForWriteCount(written, 1);
    input.write('{"jsonrpc":"2.0","method":"slow"}\n');
    input.write('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');

    await expect(request).resolves.toEqual({ ok: true });
    releaseNotification();
  });

  it("allows request handlers to await nested outbound responses", async () => {
    const { input, written, layer } = createHarness();
    layer.onRequest("nested", async () => await layer.sendRequest("lookup"));

    input.write('{"jsonrpc":"2.0","id":"agent-1","method":"nested"}\n');
    await waitForWriteCount(written, 1);
    input.write('{"jsonrpc":"2.0","id":1,"result":{"found":true}}\n');

    await waitForWriteCount(written, 2);
    expect(parseWrittenMessages(written)).toContainEqual({
      jsonrpc: "2.0",
      id: "agent-1",
      result: { found: true },
    });
  });

  it("correlates responses to pending requests for numeric, string, and null ids", async () => {
    const { input, written, layer } = createHarness();

    const numericPromise = layer.sendRequest("numeric", { value: 1 });
    const stringPromise = layer.sendRequest("string", { value: 2 }, { id: "req-2" });
    const nullPromise = layer.sendRequest("null", { value: 3 }, { id: null });

    await waitForWriteCount(written, 3);
    const outbound = parseWrittenMessages(written) as Array<{
      jsonrpc: "2.0";
      method: string;
      id: string | number | null;
    }>;

    expect(outbound[0].id).toBe(1);
    expect(outbound[1].id).toBe("req-2");
    expect(outbound[2].id).toBeNull();

    input.write('{"jsonrpc":"2.0","id":1,"result":"n"}\n');
    input.write('{"jsonrpc":"2.0","id":"req-2","result":"s"}\n');
    input.write('{"jsonrpc":"2.0","id":null,"result":"z"}\n');

    await expect(numericPromise).resolves.toBe("n");
    await expect(stringPromise).resolves.toBe("s");
    await expect(nullPromise).resolves.toBe("z");
  });

  it("rejects pending requests when response returns JSON-RPC error", async () => {
    const { input, written, layer } = createHarness();

    const pending = layer.sendRequest("auth/check", { token: "x" });

    await waitForWriteCount(written, 1);
    input.write(
      '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Auth required","data":{"methodId":"api-key"}}}\n'
    );

    await expect(pending).rejects.toMatchObject({
      message: "Auth required",
      code: -32000,
      data: { methodId: "api-key" },
    });
  });

  it("returns method_not_found for unregistered request methods", async () => {
    const { input, written } = createHarness();

    input.write('{"jsonrpc":"2.0","id":"missing","method":"nope"}\n');

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "missing",
      error: {
        code: -32601,
        message: 'Method not found: "nope"',
      },
    });
  });

  it("returns structured AcpError responses from failing request handlers", async () => {
    const { input, written, layer } = createHarness();

    layer.onRequest("fs/read", () => {
      throw {
        code: -32602,
        message: "Invalid params",
        data: { field: "path" },
      };
    });

    input.write('{"jsonrpc":"2.0","id":7,"method":"fs/read","params":{}}\n');

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32602,
        message: "Invalid params",
        data: { field: "path" },
      },
    });
  });

  it("returns parse_error response for malformed input lines", async () => {
    const { input, written } = createHarness();

    input.write("{bad-json}\n");

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
  });

  it("returns invalid_request response for structurally invalid JSON-RPC payload", async () => {
    const { input, written } = createHarness();

    input.write('{"jsonrpc":"2.0","id":"x","method":123}\n');

    await waitForWriteCount(written, 1);
    const [response] = parseWrittenMessages(written) as JsonRpcResponseMessage[];

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "x",
      error: {
        code: -32600,
        message: "Invalid Request",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Shared helpers (from poe-acp-client.test.ts)
// ---------------------------------------------------------------------------

async function* toAsync<T>(values: T[]): AsyncGenerator<T> {
  for (const value of values) {
    yield value;
  }
}

function toNotification(sessionId: string, update: SessionUpdate): SessionUpdateNotification {
  const notification = parseSessionUpdate(formatSessionUpdate(sessionId, update));
  if (!notification) {
    throw new Error("Expected valid session update notification");
  }

  return notification;
}

// ---------------------------------------------------------------------------
// jsonrpc.test.ts — formatSessionUpdate / parseSessionUpdate
// ---------------------------------------------------------------------------

describe("formatSessionUpdate", () => {
  it("formats valid JSON-RPC session/update notifications", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "hello",
      },
    };

    const json = formatSessionUpdate("session-1", update, { source: "test" });
    const parsed = JSON.parse(json) as SessionUpdateNotification;

    expect(parsed).toEqual({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update,
        _meta: { source: "test" },
      },
    });
  });

  it("rejects non-finite usage cost amounts before serialization", () => {
    expect(() => formatSessionUpdate("session-1", {
      sessionUpdate: "usage_update",
      used: 1,
      size: 2,
      cost: { amount: Number.POSITIVE_INFINITY, currency: "USD" },
    })).toThrow("usage_update cost amount must be finite");
  });
});

describe("parseSessionUpdate", () => {
  it("parses stable and unstable session update notifications", () => {
    const updates: SessionUpdate[] = [
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "user chunk" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "agent chunk" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thought" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read file",
        kind: "read",
        status: "cancelled",
        locations: [{ path: "/workspace/file.ts", lineNumber: 12 }],
        content: [
          { type: "text", text: "Reading file" },
          {
            type: "diff",
            path: "/workspace/file.ts",
            newText: "const answer = 42;",
            oldText: "const answer = 41;",
          },
          {
            type: "image",
            data: "base64-image",
            mimeType: "image/png",
          },
          {
            type: "resource_link",
            name: "Design Doc",
            uri: "file:///workspace/README.md",
          },
          {
            type: "resource",
            resource: {
              text: "contents",
              uri: "file:///workspace/README.md",
            },
          },
          {
            type: "terminal",
            terminalId: "terminal-1",
          },
        ],
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        kind: "write",
      },
      {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Inspect repository",
            priority: "high",
            status: "in_progress",
          },
        ],
      },
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "create_plan",
            description: "Create a project plan",
            input: { hint: "Feature request" },
          },
        ],
      },
      {
        sessionUpdate: "current_mode_update",
        currentModeId: "code",
      },
      {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            type: "select",
            id: "model",
            name: "Model",
            currentValue: "sonnet",
            options: [
              {
                value: "sonnet",
                name: "Sonnet",
              },
            ],
          },
        ],
      },
      {
        sessionUpdate: "session_info_update",
        title: "Refactor helper",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
      {
        sessionUpdate: "usage_update",
        used: 120,
        size: 1000,
        cost: {
          amount: 0.02,
          currency: "USD",
        },
      },
    ];

    for (const update of updates) {
      const json = formatSessionUpdate("session-42", update);
      const parsed = parseSessionUpdate(json);

      expect(parsed).toEqual({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-42",
          update,
        },
      });
    }
  });

  it("returns null for malformed json", () => {
    expect(parseSessionUpdate("{not-json}")).toBeNull();
  });

  it("returns null for non-session/update notifications", () => {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/other",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        },
      },
    });

    expect(parseSessionUpdate(message)).toBeNull();
  });

  it("returns null for notifications with invalid update payload", () => {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          title: "Missing toolCallId",
        },
      },
    });

    expect(parseSessionUpdate(message)).toBeNull();
  });

  it("returns null for notifications using legacy tool payload fields", () => {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-legacy",
          title: "Legacy call",
          kind: "edit",
          locations: [{ path: "/workspace/file.ts", line: 4 }],
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "legacy",
              },
            },
          ],
        },
      },
    });

    expect(parseSessionUpdate(message)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// run-report.test.ts
// ---------------------------------------------------------------------------

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true,
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("generateRunReportFromSessionUpdateStream", () => {
  it("builds a run report with tool calls, usage, and errors", async () => {
    const streamItems = [
      toNotification("run-42", {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Run tests",
        kind: "execute",
        status: "pending",
      }),
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "failed",
        rawOutput: "npm test failed",
      } satisfies SessionUpdate,
      {
        sessionUpdate: "usage_update",
        used: 120,
        size: 150,
      } satisfies SessionUpdate,
      {
        sessionUpdate: "usage_update",
        used: 30,
        size: 45,
        cost: { amount: 0.12, currency: "USD" },
      } satisfies SessionUpdate,
    ];

    const report = await generateRunReportFromSessionUpdateStream(toAsync(streamItems), {
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
    });

    expect(report).toEqual({
      runId: "run-42",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
      exitStatus: "failed",
      toolCalls: [
        {
          toolCallId: "tool-1",
          title: "Run tests",
          kind: "execute",
          status: "failed",
          rawOutput: "npm test failed",
        },
      ],
      usage: {
        used: 150,
        size: 195,
        cost: { amount: 0.12, currency: "USD" },
        updates: 2,
      },
      errors: [
        {
          toolCallId: "tool-1",
          message: "npm test failed",
        },
      ],
    });
  });

  it("throws when run id is missing from both options and stream", async () => {
    await expect(
      generateRunReportFromSessionUpdateStream(
        toAsync([
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          } satisfies SessionUpdate,
        ]),
      ),
    ).rejects.toThrow("Run id is required");
  });

  it.each(["", "   ", "\n"])("rejects blank run ids from options: %j", async (runId) => {
    await expect(
      generateRunReportFromSessionUpdateStream([], {
        runId,
      })
    ).rejects.toThrow(/Run id/i);
  });

  it("rejects blank run ids inferred from session update streams", async () => {
    await expect(
      generateRunReportFromSessionUpdateStream([
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "   ",
            update: { sessionUpdate: "agent_message_chunk", content: "x" },
          },
        } as unknown as SessionUpdateNotification,
      ])
    ).rejects.toThrow(/Run id/i);
  });

  it("rejects malformed explicit report timestamps instead of replacing them with now", async () => {
    await expect(
      generateRunReportFromSessionUpdateStream([], {
        runId: "run-time",
        startTime: "not-a-date",
      })
    ).rejects.toThrow(/startTime/i);
    await expect(
      generateRunReportFromSessionUpdateStream([], {
        runId: "run-time",
        endTime: "",
      })
    ).rejects.toThrow(/endTime/i);
  });

  it.each(["cancelled", "", 123])("rejects invalid explicit exitStatus %j", async (exitStatus) => {
    await expect(
      generateRunReportFromSessionUpdateStream([], {
        runId: "run-1",
        exitStatus,
      } as unknown as Parameters<typeof generateRunReportFromSessionUpdateStream>[1])
    ).rejects.toThrow(/exitStatus/i);
  });

  it("rejects usage updates with impossible numeric values", async () => {
    const invalidUpdates = [
      { sessionUpdate: "usage_update", used: -1, size: 1 },
      { sessionUpdate: "usage_update", used: 1.5, size: 2 },
      { sessionUpdate: "usage_update", used: 1, size: -2 },
      { sessionUpdate: "usage_update", used: 1, size: 2.5 },
      {
        sessionUpdate: "usage_update",
        used: 1,
        size: 2,
        cost: { amount: -0.01, currency: "USD" },
      },
      {
        sessionUpdate: "usage_update",
        used: 1,
        size: 2,
        cost: { amount: Number.POSITIVE_INFINITY, currency: "USD" },
      },
    ];

    for (const update of invalidUpdates) {
      await expect(
        generateRunReportFromSessionUpdateStream([update as unknown as SessionUpdate], {
          runId: "run-usage",
        })
      ).rejects.toThrow(/usage/i);
    }
  });
});

describe("formatRunReportSummary", () => {
  it("includes duration, tool count, token usage, and error count", () => {
    const report: RunReport = {
      runId: "run-123",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:12.500Z",
      exitStatus: "success",
      toolCalls: [
        { toolCallId: "1", title: "one", status: "completed" },
        { toolCallId: "2", title: "two", status: "completed" },
      ],
      usage: {
        used: 320,
        size: 400,
        updates: 2,
      },
      errors: [{ message: "none" }],
    };

    const summary = formatRunReportSummary(report);

    expect(summary).toContain("Duration: 12.5s");
    expect(summary).toContain("Tool count: 2");
    expect(summary).toContain("Token usage: 320/400");
    expect(summary).toContain("Error count: 1");
  });

  it("escapes newline characters in run ids", () => {
    const summary = formatRunReportSummary({
      runId: "safe\nExit status: failed",
      startTime: "2026-05-24T00:00:00.000Z",
      endTime: "2026-05-24T00:00:01.000Z",
      exitStatus: "success",
      toolCalls: [],
      usage: { used: 0, size: 0, updates: 0 },
      errors: [],
    });

    expect(summary).toContain("Run ID: safe\\nExit status: failed");
    expect(summary.split("\n").filter((line) => line.startsWith("Exit status:"))).toEqual([
      "Exit status: success",
    ]);
  });
});

describe("saveRunReport", () => {
  it("writes JSON and summary reports to ~/.poe-code/reports with timestamped names", async () => {
    const vol = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(vol).promises;

    const report: RunReport = {
      runId: "run/123",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
      exitStatus: "failed",
      toolCalls: [{ toolCallId: "tool-1", title: "Run tests", status: "failed" }],
      usage: { used: 150, size: 195, updates: 2 },
      errors: [{ message: "npm test failed", toolCallId: "tool-1" }],
    };

    const output = await saveRunReport(report, {
      fs,
      homeDir: "/home/test",
      now: () => new Date("2026-02-24T07:08:09.456Z"),
    });

    expect(output.reportsDir).toBe("/home/test/.poe-code/reports");
    expect(output.jsonPath).toBe(
      "/home/test/.poe-code/reports/20260224-070809-456-run-123-69a94e04b2.json",
    );
    expect(output.summaryPath).toBe(
      "/home/test/.poe-code/reports/20260224-070809-456-run-123-69a94e04b2.txt",
    );

    const jsonOnDisk = await fs.readFile(output.jsonPath, "utf8");
    expect(JSON.parse(jsonOnDisk)).toEqual(report);

    const summaryOnDisk = await fs.readFile(output.summaryPath, "utf8");
    expect(summaryOnDisk).toContain("Run ID: run/123");
    expect(summaryOnDisk).toContain("Error count: 1");
  });

  it("redacts raw tool content from saved JSON reports by default", async () => {
    const vol = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(vol).promises;
    const report: RunReport = {
      runId: "run-raw",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
      exitStatus: "failed",
      toolCalls: [
        {
          toolCallId: "tool-1",
          title: "Run command",
          kind: "execute",
          status: "failed",
          rawInput: { command: "curl -H 'Authorization: Bearer report-input-secret'" },
          rawOutput: "POE_API_KEY=report-output-secret",
        },
      ],
      usage: { used: 150, size: 195, updates: 2 },
      errors: [{ message: "POE_API_KEY=report-output-secret", toolCallId: "tool-1" }],
    };

    const output = await saveRunReport(report, {
      fs,
      homeDir: "/home/test",
      now: () => new Date("2026-02-24T07:08:09.456Z"),
    });
    const rawJson = await fs.readFile(output.jsonPath, "utf8");
    const jsonOnDisk = JSON.parse(rawJson) as RunReport;

    expect(jsonOnDisk.toolCalls[0]).toMatchObject({
      toolCallId: "tool-1",
      title: "Run command",
      kind: "execute",
      status: "failed",
      rawInput: "[redacted]",
      rawOutput: "[redacted]",
    });
    expect(jsonOnDisk.errors).toEqual([
      { message: "[redacted]", toolCallId: "tool-1" },
    ]);
    expect(rawJson).not.toMatch(/report-input-secret|report-output-secret/u);
  });

  it("does not follow a report file symlink inserted before JSON publish", async () => {
    const volume = Volume.fromJSON({
      "/outside/report.json": "outside-state\n",
    });
    const baseFs = createFsFromVolume(volume).promises;
    const jsonPath = "/home/test/.poe-code/reports/20260525-010203-004-run-1.json";
    const outsidePath = "/outside/report.json";
    let plantedSymlink = false;
    const fs: RunReportFileSystem = {
      mkdir: (path, options) => baseFs.mkdir(path, options),
      writeFile: async (path, data, options) => {
        await baseFs.writeFile(path, data, options);
        if (
          !plantedSymlink &&
          path.startsWith("/home/test/.poe-code/reports/.20260525-010203-004-run-1.json.") &&
          path.endsWith(".tmp")
        ) {
          plantedSymlink = true;
          await baseFs.symlink(outsidePath, jsonPath);
        }
      },
      rm: (path, options) => baseFs.rm(path, options),
      rename: (oldPath, newPath) => baseFs.rename(oldPath, newPath),
      realpath: (path) => baseFs.realpath(path) as Promise<string>,
    };
    const report: RunReport = {
      runId: "run-1",
      startTime: "2026-05-25T00:00:00.000Z",
      endTime: "2026-05-25T00:00:01.000Z",
      exitStatus: "success",
      toolCalls: [],
      usage: { used: 1, size: 2, updates: 1 },
      errors: [],
    };

    const output = await saveRunReport(report, {
      fs,
      homeDir: "/home/test",
      now: () => new Date("2026-05-25T01:02:03.004Z"),
    });

    expect(output.jsonPath).toBe(jsonPath);
    expect(plantedSymlink).toBe(true);
    expect((await baseFs.lstat(jsonPath)).isSymbolicLink()).toBe(false);
    await expect(baseFs.readFile(outsidePath, "utf8")).resolves.toBe("outside-state\n");
    expect(JSON.parse(await baseFs.readFile(jsonPath, "utf8"))).toMatchObject({
      runId: "run-1",
    });
  });

  it("preserves raw tool content when explicitly requested", async () => {
    const vol = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(vol).promises;
    const report: RunReport = {
      runId: "run-raw",
      startTime: "2026-02-24T06:00:00.000Z",
      endTime: "2026-02-24T06:00:10.000Z",
      exitStatus: "failed",
      toolCalls: [
        {
          toolCallId: "tool-1",
          title: "Run command",
          status: "failed",
          rawInput: { command: "curl -H 'Authorization: Bearer report-input-secret'" },
          rawOutput: "POE_API_KEY=report-output-secret",
        },
      ],
      usage: { used: 150, size: 195, updates: 2 },
      errors: [{ message: "POE_API_KEY=report-output-secret", toolCallId: "tool-1" }],
    };

    const output = await saveRunReport(report, {
      fs,
      homeDir: "/home/test",
      includeRawContent: true,
      now: () => new Date("2026-02-24T07:08:09.456Z"),
    });

    expect(JSON.parse(await fs.readFile(output.jsonPath, "utf8"))).toEqual(report);
  });

  it("removes a written report artifact when the companion write fails", async () => {
    const written = new Set<string>();
    const remove = vi.fn(async (path: string) => {
      written.delete(path);
    });
    const report: RunReport = {
      runId: "run-1",
      startTime: "2026-05-25T00:00:00.000Z",
      endTime: "2026-05-25T00:00:01.000Z",
      exitStatus: "success",
      toolCalls: [],
      usage: { used: 1, size: 2, updates: 1 },
      errors: [],
    };

    await expect(
      saveRunReport(report, {
        fs: {
          mkdir: async () => {},
          writeFile: async (path: string) => {
            if (path.endsWith(".txt")) {
              throw new Error("summary write failed");
            }
            written.add(path);
          },
          rm: remove,
        },
        homeDir: "/home/test",
        now: () => new Date("2026-05-25T01:02:03.004Z"),
      })
    ).rejects.toThrow("summary write failed");

    expect(written).toEqual(new Set());
    expect(remove).toHaveBeenCalledWith(
      "/home/test/.poe-code/reports/20260525-010203-004-run-1.json"
    );
  });

  it("cleans a partial JSON report temp file when the temp write fails", async () => {
    const volume = Volume.fromJSON({}, "/");
    const baseFs = createFsFromVolume(volume).promises;
    const report: RunReport = {
      runId: "run-1",
      startTime: "2026-05-25T00:00:00.000Z",
      endTime: "2026-05-25T00:00:01.000Z",
      exitStatus: "success",
      toolCalls: [],
      usage: { used: 1, size: 2, updates: 1 },
      errors: [],
    };
    const fs: RunReportFileSystem = {
      mkdir: (path, options) => baseFs.mkdir(path, options),
      writeFile: async (path, data, options) => {
        if (
          path.startsWith("/home/test/.poe-code/reports/.20260525-010203-004-run-1.json.") &&
          path.endsWith(".tmp")
        ) {
          await baseFs.writeFile(path, "partial\n", options);
          throw new Error("json report disk full");
        }
        await baseFs.writeFile(path, data, options);
      },
      rm: (path, options) => baseFs.rm(path, options),
      rename: (oldPath, newPath) => baseFs.rename(oldPath, newPath),
      realpath: (path) => baseFs.realpath(path) as Promise<string>,
    };

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        saveRunReport(report, {
          fs,
          homeDir: "/home/test",
          now: () => new Date("2026-05-25T01:02:03.004Z"),
        })
      ).rejects.toThrow("json report disk full");
    });

    const entries = await baseFs.readdir("/home/test/.poe-code/reports");
    expect(entries.some((entry) => String(entry).includes(".tmp"))).toBe(false);
    await expect(
      baseFs.readFile("/home/test/.poe-code/reports/20260525-010203-004-run-1.json", "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses distinct file paths for run ids that sanitize identically", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const now = () => new Date("2026-05-24T12:34:56.789Z");
    const report = (runId: string): RunReport => ({
      runId,
      startTime: now().toISOString(),
      endTime: now().toISOString(),
      exitStatus: "success",
      toolCalls: [],
      usage: { used: 0, size: 0, updates: 0 },
      errors: [],
    });

    const first = await saveRunReport(report("run/a"), { fs, homeDir: "/home", now });
    const second = await saveRunReport(report("run?a"), { fs, homeDir: "/home", now });

    expect(second.jsonPath).not.toBe(first.jsonPath);
    await expect(fs.readFile(first.jsonPath, "utf8")).resolves.toContain('"runId": "run/a"');
    await expect(fs.readFile(second.jsonPath, "utf8")).resolves.toContain('"runId": "run?a"');
  });

  it("rejects a symlinked reports output directory", async () => {
    const volume = Volume.fromJSON({ "/outside/keep.txt": "outside" });
    await volume.promises.mkdir("/home/.poe-code", { recursive: true });
    await volume.promises.symlink("/outside", "/home/.poe-code/reports");
    const fs = createFsFromVolume(volume).promises;
    const report: RunReport = {
      runId: "safe",
      startTime: "2026-05-24T00:00:00.000Z",
      endTime: "2026-05-24T00:00:01.000Z",
      exitStatus: "success",
      toolCalls: [],
      usage: { used: 0, size: 0, updates: 0 },
      errors: [],
    };

    await expect(saveRunReport(report, { fs, homeDir: "/home" })).rejects.toThrow(
      "reports directory must remain inside home state"
    );
  });
});

// ---------------------------------------------------------------------------
// stream-helpers.test.ts
// ---------------------------------------------------------------------------

function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => T
): T {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  try {
    return callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("extractMessagesFromSessionUpdateStream", () => {
  it("extracts user, agent, and thought chunks from mixed stream items", async () => {
    const updates: SessionUpdate[] = [
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "User question" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Assistant answer" },
      },
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Internal reasoning" },
      },
      {
        sessionUpdate: "usage_update",
        used: 42,
        size: 100,
      },
    ];

    const streamItems = [
      toNotification("session-1", updates[0]),
      updates[1],
      toNotification("session-1", updates[2]),
      updates[3],
    ];

    const extracted = await extractMessagesFromSessionUpdateStream(toAsync(streamItems));

    expect(extracted).toEqual([updates[0], updates[1], updates[2]]);
  });

  it("treats raw updates with envelope-like extension fields as raw updates", async () => {
    const rawUpdate = {
      sessionUpdate: "agent_message_chunk" as const,
      content: { type: "text" as const, text: "still a raw update" },
      jsonrpc: "2.0",
      method: "session/update",
    } satisfies SessionUpdate;

    await expect(extractMessagesFromSessionUpdateStream([rawUpdate])).resolves.toEqual([
      rawUpdate,
    ]);
  });
});

describe("extractUsageFromSessionUpdateStream", () => {
  it("extracts usage updates from a session update stream", async () => {
    const usageOne: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 20,
      size: 100,
      cost: { amount: 0.01, currency: "USD" },
    };
    const usageTwo: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 30,
      size: 120,
    };

    const streamItems = [
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      } satisfies SessionUpdate,
      toNotification("session-2", usageOne),
      usageTwo,
    ];

    const extracted = await extractUsageFromSessionUpdateStream(toAsync(streamItems));

    expect(extracted).toEqual([usageOne, usageTwo]);
  });
});

describe("extractToolCallSummariesFromSessionUpdateStream", () => {
  it("builds summaries from tool_call and tool_call_update events", async () => {
    const streamItems = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Run command",
        kind: "execute",
        status: "pending",
        rawInput: { command: "npm test" },
      } satisfies SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "in_progress",
      } satisfies SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: "ok",
      } satisfies SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        title: "Fallback",
        kind: "read",
        status: "failed",
        rawOutput: "missing file",
      } satisfies SessionUpdate,
    ];

    const extracted = await extractToolCallSummariesFromSessionUpdateStream(
      toAsync(streamItems),
    );

    const expected: ToolCallSummary[] = [
      {
        toolCallId: "tool-1",
        title: "Run command",
        kind: "execute",
        status: "completed",
        rawInput: { command: "npm test" },
        rawOutput: "ok",
      },
      {
        toolCallId: "tool-2",
        title: "Fallback",
        kind: "read",
        status: "failed",
        rawOutput: "missing file",
      },
    ];

    expect(extracted).toEqual(expected);
  });

  it("rejects duplicate tool_call start identifiers", async () => {
    const streamItems: SessionUpdate[] = [
      { sessionUpdate: "tool_call", toolCallId: "shared-id", title: "Read secrets" },
      { sessionUpdate: "tool_call", toolCallId: "shared-id", title: "Delete workspace" },
    ];

    await expect(extractToolCallSummariesFromSessionUpdateStream(streamItems)).rejects.toThrow(
      'Duplicate tool call identifier "shared-id".'
    );
  });
});

describe("mapLegacyEventToSessionUpdates", () => {
  it("maps legacy stream events into ACP session updates", () => {
    expect(
      mapLegacyEventToSessionUpdates({
        event: "agent_message",
        text: "Hello",
      }),
    ).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "reasoning",
        text: "Think step",
      }),
    ).toEqual([
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Think step" },
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_start",
        id: "tool-7",
        kind: "exec",
        title: "npm test",
        input: { command: "npm test" },
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-7",
        title: "npm test",
        kind: "execute",
        status: "pending",
        rawInput: { command: "npm test" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-7",
        kind: "execute",
        status: "in_progress",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_start",
        id: "tool-8",
        kind: "delete",
        title: "remove stale file",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-8",
        title: "remove stale file",
        kind: "write",
        status: "pending",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-8",
        kind: "write",
        status: "in_progress",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_complete",
        id: "tool-7",
        kind: "exec",
        path: "ok",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-7",
        kind: "execute",
        status: "completed",
        rawOutput: "ok",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_complete",
        id: "tool-8",
        kind: "move",
        status: "cancelled",
        path: "cancelled",
      }),
    ).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-8",
        kind: "write",
        status: "cancelled",
        rawOutput: "cancelled",
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "usage",
        inputTokens: 4,
        outputTokens: 6,
        cachedTokens: 2,
        costUsd: 0.11,
      }),
    ).toEqual([
      {
        sessionUpdate: "usage_update",
        used: 10,
        size: 12,
        cost: { amount: 0.11, currency: "USD" },
      },
    ]);

    expect(
      mapLegacyEventToSessionUpdates({
        event: "session_start",
        threadId: "thread-42",
      }),
    ).toEqual([
      {
        sessionUpdate: "session_info_update",
        _meta: { threadId: "thread-42" },
      },
    ]);

    expect(mapLegacyEventToSessionUpdates({ event: "unknown" })).toEqual([]);
  });

  it("drops legacy tool completion events with invalid explicit statuses", () => {
    expect(
      mapLegacyEventToSessionUpdates({
        event: "tool_complete",
        id: "tool-1",
        status: "error",
        output: "command failed",
      })
    ).toEqual([]);
  });

  it("ignores inherited legacy tool payload aliases", () => {
    withObjectPrototypeProperties(
      {
        input: { command: "polluted" },
        output: "polluted output",
        path: "polluted path",
        rawInput: { command: "polluted raw" },
        rawOutput: "polluted raw output",
      },
      () => {
        expect(
          mapLegacyEventToSessionUpdates({
            event: "tool_start",
            id: "tool-1",
          })
        ).toEqual([
          {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "tool-1",
            status: "pending",
          },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "in_progress",
          },
        ]);

        expect(
          mapLegacyEventToSessionUpdates({
            event: "tool_complete",
            id: "tool-1",
          })
        ).toEqual([
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
          },
        ]);
      }
    );
  });

  it("drops legacy usage events containing non-finite metrics", () => {
    expect(
      mapLegacyEventToSessionUpdates({
        event: "usage",
        inputTokens: Number.NaN,
        outputTokens: 4,
        cachedTokens: Number.POSITIVE_INFINITY,
        costUsd: Number.NaN,
      })
    ).toEqual([]);
  });
});
