import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { AcpTransport } from "./acp-transport.js";
import { AcpClient } from "./acp-client.js";
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
  TerminalOutputRequest,
  ToolCallUpdate,
  SessionNotification,
  SessionUpdate,
  WaitForTerminalExitRequest,
  WriteTextFileRequest,
} from "./types.js";

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

describe("AcpClient", () => {
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
});
