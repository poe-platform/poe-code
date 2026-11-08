import { once } from "node:events";
import { Readable } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createTestServer } from "tiny-stdio-mcp-test-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type McpTransport,
  type JsonRpcRequest,
  ERROR_INTERNAL,
  ERROR_INVALID_PARAMS,
  ERROR_INVALID_REQUEST,
  ERROR_METHOD_NOT_FOUND,
  ERROR_PARSE,
  McpError,
  SdkTransportAdapter,
  createSdkTestPair,
  createInMemoryTransportPair,
  createTestPair,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  readLines,
} from "./internal.js";
import * as api from "./index.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
});

async function readSingleLine(stream: Readable): Promise<string> {
  for await (const line of readLines(stream)) {
    return line;
  }

  throw new Error("Stream ended before a line was read");
}

class FakeClient {
  connectedTransport: McpTransport | undefined;

  readonly connect = vi.fn(async (transport: McpTransport) => {
    this.connectedTransport = transport;
  });

  readonly close = vi.fn(async () => {});
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

// --- createInMemoryTransportPair ---

describe("createInMemoryTransportPair", () => {
  it("writes from client transport to server transport readable", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    cleanup.push(() => clientTransport.dispose());

    clientTransport.writable.write('{"from":"client"}\n');

    await expect(readSingleLine(serverTransport.readable)).resolves.toBe(
      '{"from":"client"}'
    );
  });

  it("writes from server transport to client transport readable", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    cleanup.push(() => clientTransport.dispose());

    serverTransport.writable.write('{"from":"server"}\n');

    await expect(readSingleLine(clientTransport.readable)).resolves.toBe(
      '{"from":"server"}'
    );
  });

  it("dispose on client transport ends both readable streams", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    const clientReadableEnded = once(clientTransport.readable, "end");
    const serverReadableEnded = once(serverTransport.readable, "end");

    clientTransport.readable.resume();
    serverTransport.readable.resume();
    clientTransport.dispose();

    await Promise.all([clientReadableEnded, serverReadableEnded]);
    await expect(clientTransport.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});

// --- createSdkTestPair ---

describe("createSdkTestPair", () => {
  it("connects sdk server to in-memory transport and returns cleanup", async () => {
    const server = new Server({ name: "test-server", version: "1.0.0" });
    const connectSpy = vi.spyOn(server, "connect");
    const client = new FakeClient();

    const { client: connectedClient, cleanup: pairCleanup } = await createSdkTestPair(
      server,
      () => client
    );

    expect(connectedClient).toBe(client);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.connectedTransport).toBeInstanceOf(SdkTransportAdapter);

    const serverTransport = connectSpy.mock.calls[0]?.[0];
    if (serverTransport === undefined) {
      throw new Error("Expected server connect transport argument");
    }

    const closeSpy = vi.spyOn(serverTransport, "close");

    await pairCleanup();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalled();
    await expect(client.connectedTransport?.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});

// --- createTestPair ---

describe("createTestPair", () => {
  it("connects tiny server to in-memory transport and returns cleanup", async () => {
    const server = createTestServer();
    const connectSpy = vi.spyOn(server, "connect");
    const client = new FakeClient();

    const { client: connectedClient, cleanup: pairCleanup } = await createTestPair(
      server,
      () => client
    );

    expect(connectedClient).toBe(client);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);

    const serverTransport = connectSpy.mock.calls[0]?.[0];
    if (serverTransport === undefined) {
      throw new Error("Expected server connect transport argument");
    }

    if (client.connectedTransport === undefined) {
      throw new Error("Expected client to receive transport");
    }

    // Breaking readLines' async iterator destroys this shared stream. Observe
    // this one fixture write without aborting the connection under test.
    const received = once(client.connectedTransport.readable, "data");
    serverTransport.writable.write('{"from":"server"}\n');
    const [chunk] = await received;
    expect(chunk.toString()).toBe('{"from":"server"}\n');
    expect(client.connectedTransport.readable.destroyed).toBe(false);

    await pairCleanup();

    expect(client.close).toHaveBeenCalledTimes(1);
    await expect(client.connectedTransport.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});

// --- index public API exports ---

describe("index public API exports", () => {
  it("exports required runtime symbols", () => {
    expect(api).toHaveProperty("McpClient");
    expect(api).toHaveProperty("StdioTransport");
    expect(api).toHaveProperty("HttpTransport");
    expect(api).toHaveProperty("McpError");
    expect(api).toHaveProperty("JsonRpcMessageLayer");
    expect(api).toHaveProperty("createTestPair");
    expect(api).toHaveProperty("createInMemoryTransportPair");
    expect(api).toHaveProperty("createSdkTestPair");

    expect(api).toHaveProperty("ERROR_PARSE", -32700);
    expect(api).toHaveProperty("ERROR_INVALID_REQUEST", -32600);
    expect(api).toHaveProperty("ERROR_METHOD_NOT_FOUND", -32601);
    expect(api).toHaveProperty("ERROR_INVALID_PARAMS", -32602);
    expect(api).toHaveProperty("ERROR_INTERNAL", -32603);
  });

  it("does not export internal helpers", () => {
    expect(api).not.toHaveProperty("readLines");
    expect(api).not.toHaveProperty("parseJsonRpcMessage");
    expect(api).not.toHaveProperty("serializeJsonRpcMessage");
    expect(api).not.toHaveProperty("SseParser");
    expect(api).not.toHaveProperty("SdkTransportAdapter");
    expect(api).not.toHaveProperty("createMockEchoToolServer");
    expect(api).not.toHaveProperty("createMockResourceServer");
    expect(api).not.toHaveProperty("createMockPromptServer");
    expect(api).not.toHaveProperty("createMockSlowToolServer");
  });
});

// --- McpError ---

describe("McpError", () => {
  it("defines standard JSON-RPC error code constants", () => {
    expect(ERROR_PARSE).toBe(-32700);
    expect(ERROR_INVALID_REQUEST).toBe(-32600);
    expect(ERROR_METHOD_NOT_FOUND).toBe(-32601);
    expect(ERROR_INVALID_PARAMS).toBe(-32602);
    expect(ERROR_INTERNAL).toBe(-32603);
  });

  it("constructs with code, message, and data", () => {
    const data = { field: "path" };
    const error = new McpError(-32602, "Invalid params", data);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(McpError);
    expect(error.name).toBe("McpError");
    expect(error.code).toBe(-32602);
    expect(error.message).toBe("Invalid params");
    expect(error.data).toBe(data);
    expect(Object.prototype.hasOwnProperty.call(error, "data")).toBe(true);
  });

  it("does not define data when omitted", () => {
    const error = new McpError(-32600, "Invalid request");

    expect(error.data).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(error, "data")).toBe(false);
  });

  it("passes instanceof checks", () => {
    const error: Error = new McpError(-32603, "Internal error");

    expect(error instanceof Error).toBe(true);
    expect(error instanceof McpError).toBe(true);
  });
});

// --- readLines ---

describe("readLines", () => {
  it("yields complete lines from a single chunk with multiple lines", async () => {
    const stream = Readable.from(["alpha\nbeta\ngamma\n"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles lines split across multiple chunks", async () => {
    const stream = Readable.from(["al", "pha\nbe", "ta\ngam", "ma"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta", "gamma"]);
  });

  it("strips carriage returns for CR+LF line endings", async () => {
    const stream = Readable.from(["alpha\r", "\nbeta\r\n", "gamma\r\n"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta", "gamma"]);
  });

  it("yields remaining buffered content when stream closes without trailing newline", async () => {
    const stream = Readable.from(["alpha\nbeta"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta"]);
  });

  it("yields empty lines between delimiters", async () => {
    const stream = Readable.from(["alpha\n\nbeta\n"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "", "beta"]);
  });
});

// --- serializeJsonRpcMessage ---

describe("serializeJsonRpcMessage", () => {
  it("serializes JSON-RPC message to newline-delimited JSON", () => {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { cursor: "next" },
    };

    const serialized = serializeJsonRpcMessage(message);

    expect(serialized).toBe(`${JSON.stringify(message)}\n`);
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("round-trips through parseJsonRpcMessage", () => {
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "request-1",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: { text: "hello" },
      },
    };

    const parsed = parseJsonRpcMessage(serializeJsonRpcMessage(message));

    expect(parsed).toEqual({
      type: "request",
      message,
    });
  });
});

// --- SdkTransportAdapter ---

describe("SdkTransportAdapter", () => {
  it("passes messages bidirectionally between sdk transport and line streams", async () => {
    const [adapterSide, peerSide] = InMemoryTransport.createLinkedPair();
    const adapter = new SdkTransportAdapter(adapterSide);
    cleanup.push(() => adapter.dispose());

    const messageForPeer: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    };

    const onPeerMessage = new Promise<JSONRPCMessage>((resolve) => {
      peerSide.onmessage = (message) => {
        resolve(message);
      };
    });

    adapter.writable.write(`${JSON.stringify(messageForPeer)}\n`);

    await expect(onPeerMessage).resolves.toEqual(messageForPeer);

    const messageForAdapter: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    };

    await peerSide.send(messageForAdapter);

    await expect(readSingleLine(adapter.readable)).resolves.toBe(
      JSON.stringify(messageForAdapter)
    );
  });

  it("resolves closed when disposed", async () => {
    const [adapterSide] = InMemoryTransport.createLinkedPair();
    const adapter = new SdkTransportAdapter(adapterSide);

    const readableEnded = once(adapter.readable, "end");
    adapter.readable.resume();

    adapter.dispose();

    await readableEnded;
    await expect(adapter.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});
