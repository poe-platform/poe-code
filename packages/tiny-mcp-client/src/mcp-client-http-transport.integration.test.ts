import { describe, expect, it, vi } from "vitest";
import { HttpTransport, McpClient } from "./internal.js";

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface RecordedPostRequest {
  methodName: string;
  sessionId: string | null;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonRpcRequest = (body: BodyInit | null | undefined): JsonRpcRequest => {
  if (typeof body !== "string") {
    throw new Error("Expected HTTP POST body to be a JSON string");
  }

  const parsed = JSON.parse(body) as unknown;
  if (!isObjectRecord(parsed) || typeof parsed.method !== "string") {
    throw new Error("Expected HTTP POST body to contain a JSON-RPC request object");
  }

  return parsed as JsonRpcRequest;
};

const requireRequestId = (request: JsonRpcRequest): number | string => {
  if (request.id === undefined || request.id === null) {
    throw new Error(`Expected JSON-RPC request "${request.method}" to include an id`);
  }

  return request.id;
};

describe("McpClient HTTP transport integration", () => {
  it("initializes, lists tools, calls tool, tracks session, and sends DELETE on close", async () => {
    const sessionId = "session-http-integration-1";
    const recordedPostRequests: RecordedPostRequest[] = [];
    const deleteSessionIds: Array<string | null> = [];

    const mockFetch = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";

      if (method === "GET") {
        return new Response(null, { status: 405 });
      }

      const headers = new Headers(init?.headers);

      if (method === "DELETE") {
        deleteSessionIds.push(headers.get("mcp-session-id"));
        return new Response(null, { status: 204 });
      }

      if (method !== "POST") {
        throw new Error(`Unexpected HTTP method: ${method}`);
      }

      const request = parseJsonRpcRequest(init?.body);
      recordedPostRequests.push({
        methodName: request.method,
        sessionId: headers.get("mcp-session-id"),
      });

      if (request.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requireRequestId(request),
            result: {
              protocolVersion: "2025-03-26",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "mock-http-server",
                version: "1.0.0",
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Mcp-Session-Id": sessionId,
            },
          }
        );
      }

      if (request.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }

      if (request.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requireRequestId(request),
            result: {
              tools: [
                {
                  name: "echo",
                  inputSchema: {
                    type: "object",
                    properties: {
                      message: {
                        type: "string",
                      },
                    },
                    required: ["message"],
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (request.method === "tools/call") {
        if (
          !isObjectRecord(request.params) ||
          request.params.name !== "echo" ||
          !isObjectRecord(request.params.arguments) ||
          typeof request.params.arguments.message !== "string"
        ) {
          throw new Error("Expected tools/call params with name=echo and string arguments.message");
        }

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requireRequestId(request),
            result: {
              content: [
                {
                  type: "text",
                  text: request.params.arguments.message,
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      throw new Error(`Unexpected JSON-RPC method: ${request.method}`);
    });

    const client = new McpClient({
      clientInfo: {
        name: "http-integration-test-client",
        version: "1.0.0",
      },
    });
    const transport = new HttpTransport({
      url: "https://example.com/mcp",
      fetch: mockFetch,
    });

    try {
      await client.connect(transport);

      const toolsResult = await client.listTools();
      expect(toolsResult.tools).toHaveLength(1);
      expect(toolsResult.tools[0]).toMatchObject({
        name: "echo",
      });

      const callResult = await client.callTool({
        name: "echo",
        arguments: {
          message: "hello from HTTP integration",
        },
      });

      expect(callResult).toEqual({
        content: [{ type: "text", text: "hello from HTTP integration" }],
      });

      await client.close();

      await vi.waitFor(() => {
        expect(deleteSessionIds).toEqual([sessionId]);
      });

      expect(recordedPostRequests.map((request) => request.methodName)).toEqual([
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call",
      ]);

      const sessionByMethod = new Map(
        recordedPostRequests.map((request) => [request.methodName, request.sessionId] as const)
      );

      expect(sessionByMethod.get("initialize")).toBeNull();
      expect(sessionByMethod.get("notifications/initialized")).toBe(sessionId);
      expect(sessionByMethod.get("tools/list")).toBe(sessionId);
      expect(sessionByMethod.get("tools/call")).toBe(sessionId);
    } finally {
      await client.close();
    }
  });
});
