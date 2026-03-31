import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it, vi } from "bun:test";
import {
  ERROR_INVALID_REQUEST,
  ERROR_METHOD_NOT_FOUND,
  JsonRpcMessageLayer,
  McpClient,
  McpError,
  StdioTransport,
  readLines,
  type CreateMessageParams,
  type CreateMessageResult,
  type McpClientOptions,
  type ProgressParams,
  type ServerCapabilities,
  type McpTransportClosedEvent,
  type McpTransport,
  type StdioSpawn,
} from "./internal.js";

const getMessageLayerOrThrow = (client: McpClient): JsonRpcMessageLayer =>
  (
    client as unknown as {
      getMessageLayerOrThrow: () => JsonRpcMessageLayer;
    }
  ).getMessageLayerOrThrow();

const createBunBackedSpawn = (): StdioSpawn => {
  return (command, args, options) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: NodeJS.WritableStream;
      stdout: NodeJS.ReadableStream;
      stderr: NodeJS.ReadableStream;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      killed: boolean;
      kill: (signal?: NodeJS.Signals) => boolean;
      once: (event: string, listener: (...args: unknown[]) => void) => void;
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      emit: (event: string, ...args: unknown[]) => boolean;
    };

    const proc = Bun.spawn([command, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    child.stdin = proc.stdin as unknown as NodeJS.WritableStream;
    child.stdout = Readable.fromWeb(proc.stdout);
    child.stderr = Readable.fromWeb(proc.stderr);
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.kill = (signal?: NodeJS.Signals) => {
      child.killed = true;
      proc.kill(signal);
      return true;
    };

    void proc.exited
      .then((code) => {
        child.exitCode = code;
        child.emit("exit", code, null);
      })
      .catch((error) => {
        child.emit("error", error instanceof Error ? error : new Error(String(error)));
      });

    return child as unknown as ReturnType<StdioSpawn>;
  };
};

describe("McpClient constructor", () => {
  it("accepts required and optional options", () => {
    const onToolsChanged = vi.fn();
    const onResourcesChanged = vi.fn();
    const onResourceUpdated = vi.fn<(uri: string) => void>();
    const onPromptsChanged = vi.fn();
    const onLog = vi.fn();
    const onProgress = vi.fn();
    const onSamplingRequest = vi.fn(async () => ({
      model: "test-model",
      role: "assistant" as const,
      content: {
        type: "text" as const,
        text: "sample",
      },
      stopReason: "endTurn",
    }));
    const onRootsList = vi.fn(async () => [
      {
        uri: "file:///workspace",
        name: "workspace",
      },
    ]);

    const options: McpClientOptions = {
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
      onToolsChanged,
      onResourcesChanged,
      onResourceUpdated,
      onPromptsChanged,
      onLog,
      onProgress,
      onSamplingRequest,
      onRootsList,
    };

    const client = new McpClient(options);
    expect(client).toBeInstanceOf(McpClient);
  });

  it("starts in disconnected state", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.state).toBe("disconnected");
  });

  it("has null serverCapabilities before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.serverCapabilities).toBeNull();
  });

  it("has null serverInfo before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.serverInfo).toBeNull();
  });

  it("has undefined instructions before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(client.instructions).toBeUndefined();
  });
});

describe("McpClient state guards", () => {
  it("throws when guarded client method is called before connect", () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    expect(() => getMessageLayerOrThrow(client)).toThrow("MCP client is disconnected");
  });

  it("throws when connect is called on an already-connected client", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const firstTransport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const firstConnectPromise = client.connect(firstTransport);
    const firstIterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await firstIterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await firstConnectPromise;

    const secondReadable = new PassThrough();
    const secondWritable = new PassThrough();
    const secondTransport: McpTransport = {
      readable: secondReadable,
      writable: secondWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    const secondHandshake = (async () => {
      const secondIterator = readLines(secondWritable)[Symbol.asyncIterator]();
      const secondInitializeLine = await secondIterator.next();
      if (secondInitializeLine.done) {
        return;
      }

      const secondRequest = JSON.parse(secondInitializeLine.value) as { id: number };
      secondReadable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: secondRequest.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: {
              name: "server",
              version: "1.0.0",
            },
          },
        })}\n`
      );
    })();

    await expect(client.connect(secondTransport)).rejects.toThrow("MCP client is already connected");

    secondWritable.end();
    secondReadable.end();
    await secondHandshake;
    await client.close();
  });

  it("throws when guarded client method is called after close", async () => {
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    await client.close();

    expect(() => getMessageLayerOrThrow(client)).toThrow("MCP client is closed");
  });
});

describe("McpClient connect", () => {
  it("registers notification handlers for all supported server notifications", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });
    const onNotificationSpy = vi.spyOn(JsonRpcMessageLayer.prototype, "onNotification");

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as { id?: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const registeredMethods = onNotificationSpy.mock.calls.map(([method]) => method);
    expect(registeredMethods).toEqual([
      "notifications/tools/list_changed",
      "notifications/resources/list_changed",
      "notifications/resources/updated",
      "notifications/prompts/list_changed",
      "notifications/message",
      "notifications/progress",
      "notifications/cancelled",
    ]);
  });

  it("registers request handlers for ping and configured optional server requests", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest: vi.fn(async () => ({
        model: "mock-model",
        role: "assistant",
        content: {
          type: "text",
          text: "mock sample",
        },
        stopReason: "endTurn",
      })),
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });
    const onRequestSpy = vi.spyOn(JsonRpcMessageLayer.prototype, "onRequest");
    onRequestSpy.mockClear();

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as { id?: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const registeredMethods = onRequestSpy.mock.calls.map(([method]) => method);
    expect(registeredMethods).toEqual(["ping", "sampling/createMessage", "roots/list"]);
  });

  it("handles sampling/createMessage with modelPreferences, systemPrompt, and maxTokens", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const samplingResponse: CreateMessageResult = {
      model: "mock-model",
      role: "assistant",
      content: {
        type: "text",
        text: "Sampled reply.",
      },
      stopReason: "endTurn",
    };
    const onSamplingRequest = vi.fn(
      async (_params: CreateMessageParams): Promise<CreateMessageResult> => samplingResponse
    );
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const samplingRequestParams: CreateMessageParams = {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Say hello.",
          },
        },
      ],
      modelPreferences: {
        hints: [{ name: "mock-model" }],
        costPriority: 0.2,
        speedPriority: 0.4,
        intelligencePriority: 0.9,
      },
      systemPrompt: "Be concise.",
      includeContext: "thisServer",
      temperature: 0.1,
      maxTokens: 128,
      stopSequences: ["\n\n"],
      metadata: {
        requestId: "sample-1",
      },
    };
    const samplingRequestId = 779;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: samplingRequestId,
        method: "sampling/createMessage",
        params: samplingRequestParams,
      })}\n`
    );

    const samplingResponseLineResult = await iterator.next();
    if (samplingResponseLineResult.done) {
      throw new Error("Expected sampling/createMessage response line to be written");
    }

    expect(onSamplingRequest).toHaveBeenCalledTimes(1);
    expect(onSamplingRequest.mock.calls[0]?.[0]).toMatchObject({
      modelPreferences: samplingRequestParams.modelPreferences,
      systemPrompt: samplingRequestParams.systemPrompt,
      maxTokens: samplingRequestParams.maxTokens,
    });
    expect(onSamplingRequest).toHaveBeenCalledWith(samplingRequestParams);
    expect(JSON.parse(samplingResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: samplingRequestId,
      result: samplingResponse,
    });

    await client.close();
  });

  it("does not respond to sampling/createMessage after server sends notifications/cancelled", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const onSamplingRequest = vi.fn(
      async (): Promise<CreateMessageResult> =>
        await new Promise<CreateMessageResult>((resolve) => {
          setTimeout(() => {
            resolve({
              model: "mock-model",
              role: "assistant",
              content: {
                type: "text",
                text: "late sampled reply",
              },
              stopReason: "endTurn",
            });
          }, 20);
        })
    );
    const writeSpy = vi.spyOn(writable, "write");
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const samplingRequestId = 781;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: samplingRequestId,
        method: "sampling/createMessage",
        params: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Please sample.",
              },
            },
          ],
          maxTokens: 16,
        },
      })}\n`
    );
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: {
          requestId: samplingRequestId,
          reason: "server no longer needs this result",
        },
      })}\n`
    );

    await vi.waitFor(
      () => {
        expect(onSamplingRequest).toHaveBeenCalledTimes(1);
      },
      {
        timeout: 100,
      }
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(writeSpy).toHaveBeenCalledTimes(2);

    await client.close();
  });

  it("returns method-not-found when server sends sampling/createMessage and no sampling handler is set", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const samplingRequestId = 780;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: samplingRequestId,
        method: "sampling/createMessage",
        params: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Test request",
              },
            },
          ],
          maxTokens: 16,
        },
      })}\n`
    );

    const samplingResponseLineResult = await iterator.next();
    if (samplingResponseLineResult.done) {
      throw new Error("Expected sampling/createMessage response line to be written");
    }

    expect(JSON.parse(samplingResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: samplingRequestId,
      error: {
        code: ERROR_METHOD_NOT_FOUND,
        message: "Method not found: sampling/createMessage",
      },
    });

    await client.close();
  });

  it("calls onRootsList and returns roots when server sends roots/list request", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const roots = [
      {
        uri: "file:///workspace",
        name: "workspace",
      },
      {
        uri: "file:///workspace/docs",
      },
    ];
    const onRootsList = vi.fn(async () => roots);
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onRootsList,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const rootsListRequestId = 777;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: rootsListRequestId,
        method: "roots/list",
      })}\n`
    );

    const rootsListResponseLineResult = await iterator.next();
    if (rootsListResponseLineResult.done) {
      throw new Error("Expected roots/list response line to be written");
    }

    const rootsListResponse = JSON.parse(rootsListResponseLineResult.value) as unknown;
    expect(onRootsList).toHaveBeenCalledTimes(1);
    expect(rootsListResponse).toEqual({
      jsonrpc: "2.0",
      id: rootsListRequestId,
      result: {
        roots,
      },
    });

    await client.close();
  });

  it("returns method-not-found when server sends roots/list and no roots handler is set", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const rootsListRequestId = 778;
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: rootsListRequestId,
        method: "roots/list",
      })}\n`
    );

    const rootsListResponseLineResult = await iterator.next();
    if (rootsListResponseLineResult.done) {
      throw new Error("Expected roots/list response line to be written");
    }

    expect(JSON.parse(rootsListResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: rootsListRequestId,
      error: {
        code: ERROR_METHOD_NOT_FOUND,
        message: "Method not found: roots/list",
      },
    });

    await client.close();
  });

  it("calls onToolsChanged when server sends tools/list_changed notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveToolsChanged: (() => void) | null = null;
    const toolsChangedPromise = new Promise<void>((resolve) => {
      resolveToolsChanged = resolve;
    });
    const onToolsChanged = vi.fn(() => {
      if (resolveToolsChanged !== null) {
        resolveToolsChanged();
        resolveToolsChanged = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onToolsChanged,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      })}\n`
    );

    await toolsChangedPromise;

    expect(onToolsChanged).toHaveBeenCalledTimes(1);

    await client.close();
  });

  it("calls onResourcesChanged when server sends resources/list_changed notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveResourcesChanged: (() => void) | null = null;
    const resourcesChangedPromise = new Promise<void>((resolve) => {
      resolveResourcesChanged = resolve;
    });
    const onResourcesChanged = vi.fn(() => {
      if (resolveResourcesChanged !== null) {
        resolveResourcesChanged();
        resolveResourcesChanged = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onResourcesChanged,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/resources/list_changed",
      })}\n`
    );

    await resourcesChangedPromise;

    expect(onResourcesChanged).toHaveBeenCalledTimes(1);

    await client.close();
  });

  it("calls onPromptsChanged when server sends prompts/list_changed notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolvePromptsChanged: (() => void) | null = null;
    const promptsChangedPromise = new Promise<void>((resolve) => {
      resolvePromptsChanged = resolve;
    });
    const onPromptsChanged = vi.fn(() => {
      if (resolvePromptsChanged !== null) {
        resolvePromptsChanged();
        resolvePromptsChanged = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onPromptsChanged,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/prompts/list_changed",
      })}\n`
    );

    await promptsChangedPromise;

    expect(onPromptsChanged).toHaveBeenCalledTimes(1);

    await client.close();
  });

  it("calls onResourceUpdated with uri when server sends resources/updated notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveResourceUpdated: (() => void) | null = null;
    const resourceUpdatedPromise = new Promise<void>((resolve) => {
      resolveResourceUpdated = resolve;
    });
    const onResourceUpdated = vi.fn((_uri: string) => {
      if (resolveResourceUpdated !== null) {
        resolveResourceUpdated();
        resolveResourceUpdated = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onResourceUpdated,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const updatedUri = "file:///workspace/notes.txt";
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: {
          uri: updatedUri,
        },
      })}\n`
    );

    await resourceUpdatedPromise;

    expect(onResourceUpdated).toHaveBeenCalledTimes(1);
    expect(onResourceUpdated).toHaveBeenCalledWith(updatedUri);

    await client.close();
  });

  it("calls onProgress with total, progress, and message when server sends progress notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveProgressNotification: ((params: ProgressParams) => void) | null = null;
    const progressNotificationPromise = new Promise<ProgressParams>((resolve) => {
      resolveProgressNotification = resolve;
    });
    const onProgress = vi.fn((params: ProgressParams) => {
      if (resolveProgressNotification !== null) {
        resolveProgressNotification(params);
        resolveProgressNotification = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onProgress,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedProgress: ProgressParams = {
      progressToken: "call-1",
      progress: 50,
      total: 100,
      message: "Halfway there",
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: expectedProgress,
      })}\n`
    );

    await expect(progressNotificationPromise).resolves.toEqual(expectedProgress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(expectedProgress);

    await client.close();
  });

  it("calls onProgress when progress notification omits optional total", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveProgressNotification: ((params: ProgressParams) => void) | null = null;
    const progressNotificationPromise = new Promise<ProgressParams>((resolve) => {
      resolveProgressNotification = resolve;
    });
    const onProgress = vi.fn((params: ProgressParams) => {
      if (resolveProgressNotification !== null) {
        resolveProgressNotification(params);
        resolveProgressNotification = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onProgress,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedProgress: ProgressParams = {
      progressToken: "call-2",
      progress: 25,
      message: "Started processing",
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: expectedProgress,
      })}\n`
    );

    await expect(progressNotificationPromise).resolves.toEqual(expectedProgress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(expectedProgress);

    await client.close();
  });

  it("calls onProgress for multiple progress notifications in sequence", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    const expectedProgressUpdates: ProgressParams[] = [
      {
        progressToken: "call-3",
        progress: 10,
        total: 100,
        message: "Queued",
      },
      {
        progressToken: "call-3",
        progress: 50,
        total: 100,
        message: "Halfway there",
      },
      {
        progressToken: "call-3",
        progress: 100,
        total: 100,
        message: "Completed",
      },
    ];
    const receivedProgressUpdates: ProgressParams[] = [];
    let resolveProgressNotifications: ((params: ProgressParams[]) => void) | null = null;
    const progressNotificationsPromise = new Promise<ProgressParams[]>((resolve) => {
      resolveProgressNotifications = resolve;
    });
    const onProgress = vi.fn((params: ProgressParams) => {
      receivedProgressUpdates.push(params);
      if (
        resolveProgressNotifications !== null &&
        receivedProgressUpdates.length === expectedProgressUpdates.length
      ) {
        resolveProgressNotifications([...receivedProgressUpdates]);
        resolveProgressNotifications = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onProgress,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    for (const progressUpdate of expectedProgressUpdates) {
      readable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: progressUpdate,
        })}\n`
      );
    }

    await expect(progressNotificationsPromise).resolves.toEqual(expectedProgressUpdates);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, expectedProgressUpdates[0]);
    expect(onProgress).toHaveBeenNthCalledWith(2, expectedProgressUpdates[1]);
    expect(onProgress).toHaveBeenNthCalledWith(3, expectedProgressUpdates[2]);

    await client.close();
  });

  it("ignores progress notifications when onProgress callback is not configured", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: "call-without-callback",
          progress: 10,
          total: 100,
          message: "Queued",
        },
      })}\n`
    );

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(client.state).toBe("ready");

    await client.close();
  });

  it("calls onLog with debug level when server sends message notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveLogMessage: ((message: { level: string; data: unknown; logger?: string }) => void) | null =
      null;
    const logMessagePromise = new Promise<{ level: string; data: unknown; logger?: string }>(
      (resolve) => {
        resolveLogMessage = resolve;
      }
    );
    const onLog = vi.fn((message: { level: string; data: unknown; logger?: string }) => {
      if (resolveLogMessage !== null) {
        resolveLogMessage(message);
        resolveLogMessage = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onLog,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedMessage = {
      level: "debug",
      data: {
        message: "Debug message",
      },
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: expectedMessage,
      })}\n`
    );

    await expect(logMessagePromise).resolves.toEqual(expectedMessage);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expectedMessage);

    await client.close();
  });

  it("calls onLog for all syslog levels when server sends message notifications", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    const expectedMessages = [
      {
        level: "debug",
        data: { message: "Debug message" },
      },
      {
        level: "info",
        data: { message: "Info message" },
      },
      {
        level: "notice",
        data: { message: "Notice message" },
      },
      {
        level: "warning",
        data: { message: "Warning message" },
      },
      {
        level: "error",
        data: { message: "Error message" },
      },
      {
        level: "critical",
        data: { message: "Critical message" },
      },
      {
        level: "alert",
        data: { message: "Alert message" },
      },
      {
        level: "emergency",
        data: { message: "Emergency message" },
      },
    ] as const;
    const receivedMessages: Array<{ level: string; data: unknown; logger?: string }> = [];
    let resolveAllLogs: (() => void) | null = null;
    const allLogsPromise = new Promise<void>((resolve) => {
      resolveAllLogs = resolve;
    });
    const onLog = vi.fn((message: { level: string; data: unknown; logger?: string }) => {
      receivedMessages.push(message);

      if (resolveAllLogs !== null && receivedMessages.length === expectedMessages.length) {
        resolveAllLogs();
        resolveAllLogs = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onLog,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    for (const expectedMessage of expectedMessages) {
      readable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: expectedMessage,
        })}\n`
      );
    }

    await allLogsPromise;
    expect(onLog).toHaveBeenCalledTimes(expectedMessages.length);
    expect(receivedMessages).toEqual(expectedMessages);

    await client.close();
  });

  it("calls onLog with logger and structured error data when server sends message notification", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };

    let resolveLogMessage: ((message: { level: string; data: unknown; logger?: string }) => void) | null =
      null;
    const logMessagePromise = new Promise<{ level: string; data: unknown; logger?: string }>(
      (resolve) => {
        resolveLogMessage = resolve;
      }
    );
    const onLog = vi.fn((message: { level: string; data: unknown; logger?: string }) => {
      if (resolveLogMessage !== null) {
        resolveLogMessage(message);
        resolveLogMessage = null;
      }
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onLog,
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const expectedMessage = {
      level: "error",
      logger: "mock-logging-server",
      data: {
        code: "E_TOOL",
        retryable: false,
        context: {
          toolName: "emit_logs",
        },
      },
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: expectedMessage,
      })}\n`
    );

    await expect(logMessagePromise).resolves.toEqual(expectedMessage);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith(expectedMessage);

    await client.close();
  });

  it("registers only ping request handler when optional request handlers are not configured", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });
    const onRequestSpy = vi.spyOn(JsonRpcMessageLayer.prototype, "onRequest");
    onRequestSpy.mockClear();

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as { id?: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const registeredMethods = onRequestSpy.mock.calls.map(([method]) => method);
    expect(registeredMethods).toEqual(["ping"]);
  });

  it("advertises sampling capability when onSamplingRequest is provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest: vi.fn(async () => ({
        model: "mock-model",
        role: "assistant",
        content: {
          type: "text",
          text: "mock sample",
        },
        stopReason: "endTurn",
      })),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: unknown };
    };
    expect(request.params.capabilities).toEqual({
      sampling: {},
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("does not advertise sampling capability when onSamplingRequest is not provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: Record<string, unknown> };
    };
    expect(request.params.capabilities).not.toHaveProperty("sampling");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("advertises roots capability when onRootsList is provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: unknown };
    };
    expect(request.params.capabilities).toEqual({
      roots: {},
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("does not advertise roots capability when onRootsList is not provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      onSamplingRequest: vi.fn(async () => ({
        model: "mock-model",
        role: "assistant",
        content: {
          type: "text",
          text: "mock sample",
        },
        stopReason: "endTurn",
      })),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: Record<string, unknown> };
    };
    expect(request.params.capabilities).toEqual({
      sampling: {},
    });
    expect(request.params.capabilities).not.toHaveProperty("roots");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("advertises roots.listChanged when onRootsList is provided and listChanged is true", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
      onRootsList: vi.fn(async () => [
        {
          uri: "file:///workspace",
          name: "workspace",
        },
      ]),
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: unknown };
    };
    expect(request.params.capabilities).toEqual({
      roots: {
        listChanged: true,
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("does not advertise sampling or roots capabilities when handlers are not provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id: number;
      params: { capabilities: Record<string, unknown> };
    };
    expect(request.params.capabilities).not.toHaveProperty("sampling");
    expect(request.params.capabilities).not.toHaveProperty("roots");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
  });

  it("sends initialized after initialize response, stores response data, and becomes ready", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const clientInfo = {
      name: "tiny-mcp-client",
      version: "0.1.0",
    };
    const capabilities = {
      roots: {
        listChanged: true,
      },
      sampling: {},
    };
    const client = new McpClient({
      clientInfo,
      capabilities,
    });

    const connectPromise = client.connect(transport);
    expect(client.state).toBe("initializing");

    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();
    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as Record<string, unknown>;
    expect(request).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        clientInfo,
        capabilities,
      },
    });

    const initializeResult = {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      serverInfo: {
        name: "server",
        version: "1.0.0",
      },
      instructions: "Use safe mode for destructive operations.",
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: initializeResult,
      })}\n`
    );

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const initializedNotification = JSON.parse(
      initializedLineResult.value
    ) as Record<string, unknown>;
    expect(initializedNotification).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    await expect(connectPromise).resolves.toEqual(initializeResult);
    expect(client.serverCapabilities).toEqual(initializeResult.capabilities);
    expect(client.serverInfo).toEqual(initializeResult.serverInfo);
    expect(client.instructions).toBe(initializeResult.instructions);
    expect(client.state).toBe("ready");
  });

  it("rejects with McpError when server responds with a different protocol version", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const requestLineResult = await iterator.next();

    if (requestLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const request = JSON.parse(requestLineResult.value) as {
      id?: number;
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await expect(connectPromise).rejects.toBeInstanceOf(McpError);
    await expect(connectPromise).rejects.toMatchObject({
      code: ERROR_INVALID_REQUEST,
      message: "Unsupported protocol version: 2024-11-05",
    });
    expect(client.serverCapabilities).toBeNull();
    expect(client.serverInfo).toBeNull();
    expect(client.instructions).toBeUndefined();
  });
});

describe("McpClient listTools", () => {
  it("sends tools/list and returns tools from the server", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listToolsPromise = client.listTools();
    const listToolsLineResult = await iterator.next();
    if (listToolsLineResult.done) {
      throw new Error("Expected tools/list request line to be written");
    }

    const listToolsRequest = JSON.parse(listToolsLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listToolsRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list",
    });
    expect(listToolsRequest).not.toHaveProperty("params");

    const expectedTools = [
      {
        name: "echo",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
      },
    ];
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listToolsRequest.id,
        result: {
          tools: expectedTools,
        },
      })}\n`
    );

    await expect(listToolsPromise).resolves.toEqual({
      tools: expectedTools,
    });
  });

  it("sends cursor for paginated tools/list and returns nextCursor", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listToolsPromise = client.listTools({ cursor: "5" });
    const listToolsLineResult = await iterator.next();
    if (listToolsLineResult.done) {
      throw new Error("Expected tools/list request line to be written");
    }

    const listToolsRequest = JSON.parse(listToolsLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listToolsRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {
        cursor: "5",
      },
    });

    const expectedTools = [
      {
        name: "tool-6",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listToolsRequest.id,
        result: {
          tools: expectedTools,
          nextCursor: "10",
        },
      })}\n`
    );

    await expect(listToolsPromise).resolves.toEqual({
      tools: expectedTools,
      nextCursor: "10",
    });
  });
});

describe("McpClient listResources", () => {
  it("sends resources/list and returns resources from the server", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listResourcesPromise = client.listResources();
    const listResourcesLineResult = await iterator.next();
    if (listResourcesLineResult.done) {
      throw new Error("Expected resources/list request line to be written");
    }

    const listResourcesRequest = JSON.parse(listResourcesLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listResourcesRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/list",
    });
    expect(listResourcesRequest).not.toHaveProperty("params");

    const expectedResources = [
      {
        uri: "file:///readme.txt",
        name: "readme.txt",
        description: "README file for the project",
        mimeType: "text/plain",
        size: 1024,
      },
      {
        uri: "file:///image.png",
        name: "image.png",
        description: "Project image asset",
        mimeType: "image/png",
        size: 2048,
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listResourcesRequest.id,
        result: {
          resources: expectedResources,
        },
      })}\n`
    );

    await expect(listResourcesPromise).resolves.toEqual({
      resources: expectedResources,
    });
  });

  it("sends cursor for paginated resources/list and returns nextCursor", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listResourcesPromise = client.listResources({ cursor: "2" });
    const listResourcesLineResult = await iterator.next();
    if (listResourcesLineResult.done) {
      throw new Error("Expected resources/list request line to be written");
    }

    const listResourcesRequest = JSON.parse(listResourcesLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listResourcesRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/list",
      params: {
        cursor: "2",
      },
    });

    const expectedResources = [
      {
        uri: "file:///diagram.svg",
        name: "diagram.svg",
        description: "Architecture diagram",
        mimeType: "image/svg+xml",
        size: 512,
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listResourcesRequest.id,
        result: {
          resources: expectedResources,
          nextCursor: "4",
        },
      })}\n`
    );

    await expect(listResourcesPromise).resolves.toEqual({
      resources: expectedResources,
      nextCursor: "4",
    });
  });
});

describe("McpClient listResourceTemplates", () => {
  it("sends resources/templates/list and returns resource templates from the server", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listResourceTemplatesPromise = client.listResourceTemplates();
    const listResourceTemplatesLineResult = await iterator.next();
    if (listResourceTemplatesLineResult.done) {
      throw new Error("Expected resources/templates/list request line to be written");
    }

    const listResourceTemplatesRequest = JSON.parse(listResourceTemplatesLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listResourceTemplatesRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/templates/list",
    });
    expect(listResourceTemplatesRequest).not.toHaveProperty("params");

    const expectedResourceTemplates = [
      {
        uriTemplate: "file:///{path}",
        name: "file-template",
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listResourceTemplatesRequest.id,
        result: {
          resourceTemplates: expectedResourceTemplates,
        },
      })}\n`
    );

    await expect(listResourceTemplatesPromise).resolves.toEqual({
      resourceTemplates: expectedResourceTemplates,
    });
  });
});

describe("McpClient listPrompts", () => {
  it("sends prompts/list and returns prompts with name, description, and arguments", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const listPromptsPromise = client.listPrompts();
    const listPromptsLineResult = await iterator.next();
    if (listPromptsLineResult.done) {
      throw new Error("Expected prompts/list request line to be written");
    }

    const listPromptsRequest = JSON.parse(listPromptsLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(listPromptsRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/list",
    });
    expect(listPromptsRequest).not.toHaveProperty("params");

    const expectedPrompts = [
      {
        name: "code_review",
        description: "Review code for correctness and maintainability.",
        arguments: [
          {
            name: "code",
            description: "Code snippet to review",
            required: true,
          },
        ],
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: listPromptsRequest.id,
        result: {
          prompts: expectedPrompts,
          nextCursor: "2",
        },
      })}\n`
    );

    await expect(listPromptsPromise).resolves.toEqual({
      prompts: expectedPrompts,
      nextCursor: "2",
    });
  });
});

describe("McpClient getPrompt", () => {
  it("sends prompts/get without arguments and returns prompt messages", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const getPromptPromise = client.getPrompt({ name: "summarize" });
    const getPromptLineResult = await iterator.next();
    if (getPromptLineResult.done) {
      throw new Error("Expected prompts/get request line to be written");
    }

    const getPromptRequest = JSON.parse(getPromptLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(getPromptRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/get",
      params: {
        name: "summarize",
      },
    });
    expect(getPromptRequest.params).not.toHaveProperty("arguments");

    const expectedMessages = [
      {
        role: "user",
        content: {
          type: "text",
          text: "Please summarize the provided text.",
        },
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: getPromptRequest.id,
        result: {
          messages: expectedMessages,
        },
      })}\n`
    );

    await expect(getPromptPromise).resolves.toEqual({
      messages: expectedMessages,
    });
  });

  it("sends prompts/get with arguments and returns expanded prompt messages", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const getPromptPromise = client.getPrompt({
      name: "code_review",
      arguments: {
        code: "const answer = 42;",
      },
    });
    const getPromptLineResult = await iterator.next();
    if (getPromptLineResult.done) {
      throw new Error("Expected prompts/get request line to be written");
    }

    const getPromptRequest = JSON.parse(getPromptLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(getPromptRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/get",
      params: {
        name: "code_review",
        arguments: {
          code: "const answer = 42;",
        },
      },
    });

    const expectedResult = {
      description: "Review code for correctness and maintainability.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Please review the following code:\nconst answer = 42;",
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: "I will review the code for potential issues and improvements.",
          },
        },
      ],
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: getPromptRequest.id,
        result: expectedResult,
      })}\n`
    );

    await expect(getPromptPromise).resolves.toEqual(expectedResult);
  });

  it("returns text, image, and embedded resource prompt content with user and assistant roles", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const getPromptPromise = client.getPrompt({ name: "content_types" });
    const getPromptLineResult = await iterator.next();
    if (getPromptLineResult.done) {
      throw new Error("Expected prompts/get request line to be written");
    }

    const getPromptRequest = JSON.parse(getPromptLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(getPromptRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "prompts/get",
      params: {
        name: "content_types",
      },
    });

    const textMessage = {
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "Describe the image and attached context.",
      },
    };
    const imageMessage = {
      role: "assistant" as const,
      content: {
        type: "image" as const,
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        mimeType: "image/png",
      },
    };
    const resourceMessage = {
      role: "assistant" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: "file:///context.txt",
          mimeType: "text/plain",
          text: "This context came from an embedded resource.",
        },
      },
    };
    const expectedResult = {
      messages: [textMessage, imageMessage, resourceMessage],
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: getPromptRequest.id,
        result: expectedResult,
      })}\n`
    );

    const result = await getPromptPromise;
    expect(result).toEqual(expectedResult);
    expect(result.messages[0]?.content).toEqual(textMessage.content);
    expect(result.messages[1]?.content).toEqual(imageMessage.content);
    expect(result.messages[2]?.content).toEqual(resourceMessage.content);
    expect(new Set(result.messages.map((message) => message.role))).toEqual(
      new Set(["user", "assistant"])
    );
  });
});

describe("McpClient complete", () => {
  it("sends completion/complete with prompt ref and returns hasMore and total", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            completions: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const completePromise = client.complete({
      ref: {
        type: "ref/prompt",
        name: "code_review",
      },
      argument: {
        name: "language",
        value: "py",
      },
    });
    const completeLineResult = await iterator.next();
    if (completeLineResult.done) {
      throw new Error("Expected completion/complete request line to be written");
    }

    const completeRequest = JSON.parse(completeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(completeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "completion/complete",
      params: {
        ref: {
          type: "ref/prompt",
          name: "code_review",
        },
        argument: {
          name: "language",
          value: "py",
        },
      },
    });

    const expectedResult = {
      completion: {
        values: ["python", "pydantic", "pytest"],
        hasMore: true,
        total: 5,
      },
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: completeRequest.id,
        result: expectedResult,
      })}\n`
    );

    await expect(completePromise).resolves.toEqual(expectedResult);
  });

  it("returns completion values capped at 100 entries", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            completions: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const completePromise = client.complete({
      ref: {
        type: "ref/prompt",
        name: "code_review",
      },
      argument: {
        name: "language",
        value: "p",
      },
    });
    const completeLineResult = await iterator.next();
    if (completeLineResult.done) {
      throw new Error("Expected completion/complete request line to be written");
    }

    const completeRequest = JSON.parse(completeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    const values = Array.from({ length: 100 }, (_, index) => `candidate-${index + 1}`);
    const expectedResult = {
      completion: {
        values,
        hasMore: true,
        total: 157,
      },
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: completeRequest.id,
        result: expectedResult,
      })}\n`
    );

    const result = await completePromise;
    expect(result.completion.values).toHaveLength(100);
    expect(result).toEqual(expectedResult);
  });

  it("sends completion/complete with resource ref and returns completion values", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            completions: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const completePromise = client.complete({
      ref: {
        type: "ref/resource",
        uri: "file:///workspace/{path}",
      },
      argument: {
        name: "path",
        value: "doc",
      },
    });
    const completeLineResult = await iterator.next();
    if (completeLineResult.done) {
      throw new Error("Expected completion/complete request line to be written");
    }

    const completeRequest = JSON.parse(completeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(completeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "completion/complete",
      params: {
        ref: {
          type: "ref/resource",
          uri: "file:///workspace/{path}",
        },
        argument: {
          name: "path",
          value: "doc",
        },
      },
    });

    const expectedResult = {
      completion: {
        values: ["docs/", "docs/api.md", "docs/guide.md"],
      },
    };

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: completeRequest.id,
        result: expectedResult,
      })}\n`
    );

    await expect(completePromise).resolves.toEqual(expectedResult);
  });
});

describe("McpClient readResource", () => {
  it("sends resources/read with uri and returns text resource contents", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const readResourcePromise = client.readResource({ uri: "file:///readme.txt" });
    const readResourceLineResult = await iterator.next();
    if (readResourceLineResult.done) {
      throw new Error("Expected resources/read request line to be written");
    }

    const readResourceRequest = JSON.parse(readResourceLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(readResourceRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/read",
      params: {
        uri: "file:///readme.txt",
      },
    });

    const expectedContents = [
      {
        uri: "file:///readme.txt",
        mimeType: "text/plain",
        text: "This is a mock README resource.",
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: readResourceRequest.id,
        result: {
          contents: expectedContents,
        },
      })}\n`
    );

    await expect(readResourcePromise).resolves.toEqual({
      contents: expectedContents,
    });
  });

  it("sends resources/read with uri and returns binary resource contents", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const readResourcePromise = client.readResource({ uri: "file:///image.png" });
    const readResourceLineResult = await iterator.next();
    if (readResourceLineResult.done) {
      throw new Error("Expected resources/read request line to be written");
    }

    const readResourceRequest = JSON.parse(readResourceLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(readResourceRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/read",
      params: {
        uri: "file:///image.png",
      },
    });

    const expectedContents = [
      {
        uri: "file:///image.png",
        mimeType: "image/png",
        blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgL9qj3QAAAAASUVORK5CYII=",
      },
    ];

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: readResourceRequest.id,
        result: {
          contents: expectedContents,
        },
      })}\n`
    );

    await expect(readResourcePromise).resolves.toEqual({
      contents: expectedContents,
    });
  });

  it("rejects with McpError when reading a nonexistent URI", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const missingUri = "file:///missing.txt";
    const readResourcePromise = client.readResource({ uri: missingUri });
    const readResourceLineResult = await iterator.next();
    if (readResourceLineResult.done) {
      throw new Error("Expected resources/read request line to be written");
    }

    const readResourceRequest = JSON.parse(readResourceLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(readResourceRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/read",
      params: {
        uri: missingUri,
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: readResourceRequest.id,
        error: {
          code: -32002,
          message: `Resource not found: ${missingUri}`,
        },
      })}\n`
    );

    await expect(readResourcePromise).rejects.toBeInstanceOf(McpError);
    await expect(readResourcePromise).rejects.toMatchObject({
      code: -32002,
      message: `Resource not found: ${missingUri}`,
    });
  });
});

describe("McpClient resource subscriptions", () => {
  it("sends resources/subscribe with uri", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {
              subscribe: true,
            },
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const subscribePromise = client.subscribe("file:///readme.txt");
    const subscribeLineResult = await iterator.next();
    if (subscribeLineResult.done) {
      throw new Error("Expected resources/subscribe request line to be written");
    }

    const subscribeRequest = JSON.parse(subscribeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(subscribeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/subscribe",
      params: {
        uri: "file:///readme.txt",
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: subscribeRequest.id,
        result: {},
      })}\n`
    );

    await expect(subscribePromise).resolves.toBeUndefined();
  });

  it("sends resources/unsubscribe with uri", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {
              subscribe: true,
            },
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const unsubscribePromise = client.unsubscribe("file:///readme.txt");
    const unsubscribeLineResult = await iterator.next();
    if (unsubscribeLineResult.done) {
      throw new Error("Expected resources/unsubscribe request line to be written");
    }

    const unsubscribeRequest = JSON.parse(unsubscribeLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(unsubscribeRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/unsubscribe",
      params: {
        uri: "file:///readme.txt",
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: unsubscribeRequest.id,
        result: {},
      })}\n`
    );

    await expect(unsubscribePromise).resolves.toBeUndefined();
  });
});

describe("McpClient callTool", () => {
  it("sends tools/call with name and arguments and returns content with optional isError", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const callToolPromise = client.callTool({
      name: "echo",
      arguments: {
        message: "hello from test",
      },
    });
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    expect(callToolRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "tool error",
            },
          ],
          isError: true,
        },
      })}\n`
    );

    await expect(callToolPromise).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "tool error",
        },
      ],
      isError: true,
    });
  });

  it("includes _meta.progressToken in tools/call when progressToken option is provided", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const callToolPromise = client.callTool(
      {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
      { progressToken: "call-1" }
    );
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    expect(callToolRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
        _meta: {
          progressToken: "call-1",
        },
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "done",
            },
          ],
        },
      })}\n`
    );

    await expect(callToolPromise).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "done",
        },
      ],
    });

    await client.close();
  });

  it("sends notifications/cancelled and rejects with abort reason when signal aborts", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const abortController = new AbortController();
    const callToolPromise = client.callTool(
      {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
      { signal: abortController.signal }
    );
    // Suppress unhandled rejection - bun fails tests on unhandled rejections
    // before the assertion can catch them when using deferred rejects.toBe()
    callToolPromise.catch(() => undefined);
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
    };
    abortController.abort("user cancelled");

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: callToolRequest.id,
      },
    });

    await expect(callToolPromise).rejects.toBe("user cancelled");
    await client.close();
  });

  it("does not send notifications/cancelled when signal aborts after completion", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const abortController = new AbortController();
    const addEventListenerSpy = vi.spyOn(abortController.signal, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(abortController.signal, "removeEventListener");
    const callToolPromise = client.callTool(
      {
        name: "echo",
      },
      { signal: abortController.signal }
    );
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as {
      id: number;
    };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "done",
            },
          ],
        },
      })}\n`
    );

    await expect(callToolPromise).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "done",
        },
      ],
    });

    const addedAbortListener = addEventListenerSpy.mock.calls[0]?.[1];
    expect(addedAbortListener).toBeDefined();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", addedAbortListener);

    expect(writable.readableLength).toBe(0);
    abortController.abort("too late");
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(writable.readableLength).toBe(0);

    await client.close();
  });
});

describe("McpClient setLogLevel", () => {
  it("sends logging/setLevel with level and resolves on success response", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            logging: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const setLogLevelPromise = client.setLogLevel("info");
    const setLogLevelLineResult = await iterator.next();
    if (setLogLevelLineResult.done) {
      throw new Error("Expected logging/setLevel request line to be written");
    }

    const setLogLevelRequest = JSON.parse(setLogLevelLineResult.value) as {
      id: number;
      method: string;
      params?: Record<string, unknown>;
    };
    expect(setLogLevelRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "logging/setLevel",
      params: {
        level: "info",
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: setLogLevelRequest.id,
        result: {},
      })}\n`
    );

    await expect(setLogLevelPromise).resolves.toBeUndefined();
  });
});

describe("McpClient sendRootsChanged", () => {
  it("writes notifications/roots/list_changed to the transport", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    await client.sendRootsChanged();

    const rootsChangedLineResult = await iterator.next();
    if (rootsChangedLineResult.done) {
      throw new Error("Expected roots/list_changed notification line to be written");
    }

    expect(JSON.parse(rootsChangedLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/roots/list_changed",
    });
  });
});

describe("McpClient cancel", () => {
  it("sends notifications/cancelled with requestId and reason", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    await client.cancel(1, "user cancelled");

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: 1,
        reason: "user cancelled",
      },
    });

    await client.close();
  });

  it("sends notifications/cancelled with requestId and without reason", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    await client.cancel(1);

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: 1,
      },
    });

    await client.close();
  });

  it("does not throw when cancelling an already-completed request", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const pingPromise = client.ping();
    const pingLineResult = await iterator.next();
    if (pingLineResult.done) {
      throw new Error("Expected ping request line to be written");
    }

    const pingRequest = JSON.parse(pingLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: pingRequest.id,
        result: {},
      })}\n`
    );
    await expect(pingPromise).resolves.toBeUndefined();

    await expect(client.cancel(pingRequest.id)).resolves.toBeUndefined();

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: pingRequest.id,
      },
    });

    await client.close();
  });

  it("does not throw when cancelling an unknown request id", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const unknownRequestId = "missing-request-id";
    await expect(client.cancel(unknownRequestId)).resolves.toBeUndefined();

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: unknownRequestId,
      },
    });

    await client.close();
  });

  it("ignores a response that arrives after request cancellation", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const abortController = new AbortController();
    const callToolPromise = client.callTool(
      {
        name: "echo",
        arguments: {
          message: "hello from test",
        },
      },
      { signal: abortController.signal }
    );
    // Suppress unhandled rejection - bun fails tests on unhandled rejections
    // before the assertion can catch them when using deferred rejects.toBe()
    callToolPromise.catch(() => undefined);
    const callToolLineResult = await iterator.next();
    if (callToolLineResult.done) {
      throw new Error("Expected tools/call request line to be written");
    }

    const callToolRequest = JSON.parse(callToolLineResult.value) as { id: number };
    abortController.abort("user cancelled");

    const cancelledLineResult = await iterator.next();
    if (cancelledLineResult.done) {
      throw new Error("Expected cancelled notification line to be written");
    }

    expect(JSON.parse(cancelledLineResult.value)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {
        requestId: callToolRequest.id,
      },
    });

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: callToolRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "late tool result",
            },
          ],
        },
      })}\n`
    );

    await expect(callToolPromise).rejects.toBe("user cancelled");

    const pingPromise = client.ping();
    const pingLineResult = await iterator.next();
    if (pingLineResult.done) {
      throw new Error("Expected ping request line to be written");
    }

    const pingRequest = JSON.parse(pingLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: pingRequest.id,
        result: {},
      })}\n`
    );
    await expect(pingPromise).resolves.toBeUndefined();

    await client.close();
  });
});

describe("McpClient ping", () => {
  it("sends ping request and resolves when the server returns an empty response", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const pingPromise = client.ping();
    const pingLineResult = await iterator.next();
    if (pingLineResult.done) {
      throw new Error("Expected ping request line to be written");
    }

    const pingRequest = JSON.parse(pingLineResult.value) as {
      id: number;
      method: string;
    };
    expect(pingRequest.method).toBe("ping");

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: pingRequest.id,
        result: {},
      })}\n`
    );

    await expect(pingPromise).resolves.toBeUndefined();
  });

  it("rejects when ping response is not received before request timeout", async () => {
    vi.useFakeTimers();
    try {
      const readable = new PassThrough();
      const writable = new PassThrough();
      const transport: McpTransport = {
        readable,
        writable,
        closed: new Promise(() => {}),
        dispose: vi.fn(),
      };
      const client = new McpClient({
        clientInfo: {
          name: "tiny-mcp-client",
          version: "0.1.0",
        },
      });

      const connectPromise = client.connect(transport);
      const iterator = readLines(writable)[Symbol.asyncIterator]();
      const initializeLineResult = await iterator.next();
      if (initializeLineResult.done) {
        throw new Error("Expected initialize request line to be written");
      }

      const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
      readable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: initializeRequest.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: {
              name: "server",
              version: "1.0.0",
            },
          },
        })}\n`
      );

      await connectPromise;

      const initializedLineResult = await iterator.next();
      if (initializedLineResult.done) {
        throw new Error("Expected initialized notification line to be written");
      }

      const pingPromise = client.ping();
      const pingLineResult = await iterator.next();
      if (pingLineResult.done) {
        throw new Error("Expected ping request line to be written");
      }

      const pingRequest = JSON.parse(pingLineResult.value) as {
        method: string;
      };
      expect(pingRequest.method).toBe("ping");

      vi.advanceTimersByTime(30_000);
      // Flush microtasks to let the rejection propagate
      await Promise.resolve();
      await Promise.resolve();

      await expect(pingPromise).rejects.toThrow(
        'JSON-RPC request "ping" timed out after 30000ms'
      );
      await client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("responds with an empty object when the server sends a ping request", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();
    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedLineResult = await iterator.next();
    if (initializedLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "server-ping-1",
        method: "ping",
      })}\n`
    );

    const pingResponseLineResult = await iterator.next();
    if (pingResponseLineResult.done) {
      throw new Error("Expected ping response line to be written");
    }

    expect(JSON.parse(pingResponseLineResult.value)).toEqual({
      jsonrpc: "2.0",
      id: "server-ping-1",
      result: {},
    });
  });
});

describe("McpClient close", () => {
  it("can connect, close, and then connect again with a new transport", async () => {
    const firstReadable = new PassThrough();
    const firstWritable = new PassThrough();
    const firstTransport: McpTransport = {
      readable: firstReadable,
      writable: firstWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const firstConnectPromise = client.connect(firstTransport);
    const firstIterator = readLines(firstWritable)[Symbol.asyncIterator]();
    const firstInitializeLineResult = await firstIterator.next();
    if (firstInitializeLineResult.done) {
      throw new Error("Expected first initialize request line to be written");
    }

    const firstInitializeRequest = JSON.parse(firstInitializeLineResult.value) as {
      id: number;
    };
    firstReadable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: firstInitializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "first-server",
            version: "1.0.0",
          },
        },
      })}\n`
    );
    await firstConnectPromise;
    await client.close();

    expect(firstTransport.dispose).toHaveBeenCalledTimes(1);
    expect(client.state).toBe("closed");

    const secondReadable = new PassThrough();
    const secondWritable = new PassThrough();
    const secondTransport: McpTransport = {
      readable: secondReadable,
      writable: secondWritable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const secondHandshake = (async () => {
      const secondIterator = readLines(secondWritable)[Symbol.asyncIterator]();
      const secondInitializeLineResult = await secondIterator.next();
      if (secondInitializeLineResult.done) {
        throw new Error("Expected second initialize request line to be written");
      }

      const secondInitializeRequest = JSON.parse(secondInitializeLineResult.value) as {
        id: number;
      };
      secondReadable.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: secondInitializeRequest.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: {
              name: "second-server",
              version: "2.0.0",
            },
          },
        })}\n`
      );
    })();

    await expect(client.connect(secondTransport)).resolves.toMatchObject({
      protocolVersion: "2025-03-26",
      serverInfo: {
        name: "second-server",
        version: "2.0.0",
      },
    });
    await secondHandshake;

    expect(client.serverInfo).toEqual({
      name: "second-server",
      version: "2.0.0",
    });
    expect(client.state).toBe("ready");

    await client.close();
    expect(secondTransport.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects connect when closed immediately before initialize handshake completes", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    await client.close();

    expect(transport.dispose).toHaveBeenCalledTimes(1);
    await expect(connectPromise).rejects.toThrow("MCP client closed");
    expect(client.state).toBe("closed");
  });

  it("close with pending requests rejects all requests and disposes message layer + transport", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLine = await iterator.next();
    if (initializeLine.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const activeMessageLayer = (
      client as unknown as {
        messageLayer: JsonRpcMessageLayer | null;
      }
    ).messageLayer;

    if (activeMessageLayer === null) {
      throw new Error("Expected message layer to exist after connect");
    }

    const pendingToolsRequest = activeMessageLayer.sendRequest("tools/list");
    const pendingPromptsRequest = activeMessageLayer.sendRequest("prompts/list");

    await client.close();

    expect(transport.dispose).toHaveBeenCalledTimes(1);
    await expect(connectPromise).rejects.toThrow("MCP client closed");
    await expect(pendingToolsRequest).rejects.toThrow("MCP client closed");
    await expect(pendingPromptsRequest).rejects.toThrow("MCP client closed");
  });

  it("transitions state to closed after close", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLine = await iterator.next();

    if (initializeLine.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLine.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
    expect(client.state).toBe("ready");

    await client.close();

    expect(client.state).toBe("closed");
  });
});

describe("McpClient unexpected transport close", () => {
  it("rejects all pending requests when transport closes unexpectedly", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    let resolveClosed: (closedEvent: McpTransportClosedEvent) => void = () => undefined;
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise((resolve) => {
        resolveClosed = resolve;
      }),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();

    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    const initializedNotificationLineResult = await iterator.next();
    if (initializedNotificationLineResult.done) {
      throw new Error("Expected initialized notification line to be written");
    }

    const activeMessageLayer = (
      client as unknown as {
        messageLayer: JsonRpcMessageLayer | null;
      }
    ).messageLayer;

    if (activeMessageLayer === null) {
      throw new Error("Expected message layer to exist after connect");
    }

    const pendingToolsRequest = activeMessageLayer.sendRequest("tools/list");
    const pendingPromptsRequest = activeMessageLayer.sendRequest("prompts/list");

    // Suppress unhandled rejections - bun fails tests on unhandled rejections before
    // the assertions can catch them when promises reject synchronously on resolveClosed()
    pendingToolsRequest.catch(() => undefined);
    pendingPromptsRequest.catch(() => undefined);

    const firstPendingRequestLine = await iterator.next();
    if (firstPendingRequestLine.done) {
      throw new Error("Expected first pending request line to be written");
    }

    const secondPendingRequestLine = await iterator.next();
    if (secondPendingRequestLine.done) {
      throw new Error("Expected second pending request line to be written");
    }

    resolveClosed({
      reason: new Error("transport closed unexpectedly"),
    });

    await expect(pendingToolsRequest).rejects.toThrow("transport closed unexpectedly");
    await expect(pendingPromptsRequest).rejects.toThrow("transport closed unexpectedly");
  });

  it("transitions state to closed when transport closes unexpectedly", async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    let resolveClosed: (closedEvent: McpTransportClosedEvent) => void = () => undefined;
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise((resolve) => {
        resolveClosed = resolve;
      }),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();

    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;
    expect(client.state).toBe("ready");

    resolveClosed({
      reason: new Error("transport crashed"),
    });

    await Promise.resolve();

    expect(client.state).toBe("closed");
  });

  it("rejects pending requests on stdio process crash and exposes stderr output", async () => {
    const crashingServerScript = [
      'const readline = require("node:readline");',
      "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
      'rl.on("line", (line) => {',
      "  const message = JSON.parse(line);",
      '  if (message.method === "initialize") {',
      "    process.stdout.write(JSON.stringify({",
      '      jsonrpc: "2.0",',
      "      id: message.id,",
      "      result: {",
      '        protocolVersion: "2025-03-26",',
      "        capabilities: { tools: {} },",
      '        serverInfo: { name: "crashing-server", version: "0.0.0-test" }',
      "      }",
      '    }) + "\\n");',
      "    return;",
      "  }",
      '  if (message.method === "notifications/initialized") {',
      "    return;",
      "  }",
      '  if (message.method === "tools/list") {',
      '    process.stderr.write("crash: tools/list before response\\n");',
      "    process.exit(1);",
      "  }",
      "});",
    ].join("\n");
    const transport = new StdioTransport({
      command: process.execPath,
      args: ["-e", crashingServerScript],
      spawn: createBunBackedSpawn(),
    });
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    await client.connect(transport);

    const pendingToolsRequest = client.listTools();
    await expect(pendingToolsRequest).rejects.toThrow("Stdio transport process exited");

    const closedEvent = await transport.closed;
    expect(closedEvent.reason).toBeInstanceOf(Error);
    expect(closedEvent.reason.message).toBe("Stdio transport process exited");
    expect(closedEvent.code).toBe(1);
    expect(closedEvent.signal).toBeUndefined();
    expect(transport.getStderrOutput()).toContain("crash: tools/list before response");
    expect(client.state).toBe("closed");
  });
});

describe("McpClient capability gating", () => {
  const createConnectedClient = async (
    serverCapabilities: ServerCapabilities
  ): Promise<{ client: McpClient; closeClient: () => Promise<void> }> => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport: McpTransport = {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose: vi.fn(),
    };
    const client = new McpClient({
      clientInfo: {
        name: "tiny-mcp-client",
        version: "0.1.0",
      },
    });

    const connectPromise = client.connect(transport);
    const iterator = readLines(writable)[Symbol.asyncIterator]();
    const initializeLineResult = await iterator.next();

    if (initializeLineResult.done) {
      throw new Error("Expected initialize request line to be written");
    }

    const initializeRequest = JSON.parse(initializeLineResult.value) as { id: number };
    readable.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: initializeRequest.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: serverCapabilities,
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    await connectPromise;

    return {
      client,
      closeClient: async () => {
        await client.close();
      },
    };
  };

  it("listTools throws when server has no tools capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.listTools()).rejects.toThrow("Server does not support tools");
    } finally {
      await closeClient();
    }
  });

  it("listResources throws when server has no resources capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.listResources()).rejects.toThrow("Server does not support resources");
    } finally {
      await closeClient();
    }
  });

  it("subscribe throws when server resources.subscribe is not true", async () => {
    const { client, closeClient } = await createConnectedClient({
      resources: {},
    });

    try {
      await expect(client.subscribe("file:///readme.txt")).rejects.toThrow(
        "Server does not support resource subscriptions"
      );
    } finally {
      await closeClient();
    }
  });

  it("unsubscribe throws when server resources.subscribe is not true", async () => {
    const { client, closeClient } = await createConnectedClient({
      resources: {},
    });

    try {
      await expect(client.unsubscribe("file:///readme.txt")).rejects.toThrow(
        "Server does not support resource subscriptions"
      );
    } finally {
      await closeClient();
    }
  });

  it("listPrompts throws when server has no prompts capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.listPrompts()).rejects.toThrow("Server does not support prompts");
    } finally {
      await closeClient();
    }
  });

  it("complete throws when server has no completions capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(
        client.complete({
          ref: {
            type: "ref/prompt",
            name: "code_review",
          },
          argument: {
            name: "language",
            value: "py",
          },
        })
      ).rejects.toThrow("Server does not support completions");
    } finally {
      await closeClient();
    }
  });

  it("setLogLevel throws when server has no logging capability", async () => {
    const { client, closeClient } = await createConnectedClient({});

    try {
      await expect(client.setLogLevel("info")).rejects.toThrow("Server does not support logging");
    } finally {
      await closeClient();
    }
  });
});
