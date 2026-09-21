import { HttpTransport, HttpTransportError, McpClient } from "tiny-mcp-client";
import type { RemoteMcpServer, SchemaFetchOptions } from "./schema.js";

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function remoteLimits(options: SchemaFetchOptions) {
  const requestTimeoutMs = positiveLimit(options.requestTimeoutMs ?? 30_000, "requestTimeoutMs");
  if (requestTimeoutMs > 2_147_483_647) throw new Error("requestTimeoutMs must not exceed 2147483647");
  return {
    maxPages: positiveLimit(options.maxPages ?? 100, "maxPages"),
    maxTools: positiveLimit(options.maxTools ?? 10_000, "maxTools"),
    maxResponseBytes: positiveLimit(options.maxResponseBytes ?? 16 * 1024 * 1024, "maxResponseBytes"),
    requestTimeoutMs
  };
}

/** Own connection negotiation and cleanup for a single schema or tool operation. */
export async function withRemoteMcpClient<T>(
  server: RemoteMcpServer,
  options: SchemaFetchOptions,
  operation: (client: McpClient, limits: ReturnType<typeof remoteLimits>) => Promise<T>,
  mode: "streamable-http" | "sse" = server.transport === "sse" ? "sse" : "streamable-http"
): Promise<T> {
  options.signal?.throwIfAborted();
  const limits = remoteLimits(options);
  const client = new McpClient({
    clientInfo: { name: "safe-bash-mcp", version: "0.0.1" },
    protocolVersion: server.protocolVersion,
    requestTimeoutMs: limits.requestTimeoutMs
  });
  const transport = new HttpTransport({
    url: server.url, mode, headers: server.headers, oauth: server.oauth,
    fetch: options.fetch, oauthDiscoveryCache: options.oauthDiscoveryCache,
    onWarning: options.onWarning, maxResponseBytes: limits.maxResponseBytes
  });
  try {
    if (server.tools !== undefined && transport.filterTools([...server.tools]).length !== server.tools.length)
      throw new Error("Unsupported MCP parameter header metadata in supplied schemas");
    try {
      await client.connect(transport, { signal: options.signal });
    } catch (primaryError) {
      options.signal?.throwIfAborted();
      if (server.transport !== undefined || mode !== "streamable-http" ||
          !(primaryError instanceof HttpTransportError) || primaryError.method !== "POST" ||
          (primaryError.rpcMethod !== undefined && primaryError.rpcMethod !== "initialize" && primaryError.rpcMethod !== "server/discover") ||
          (primaryError.status !== 404 && primaryError.status !== 405)) throw primaryError;
      await client.close();
      transport.dispose();
      await transport.closed;
      options.signal?.throwIfAborted();
      try { return await withRemoteMcpClient(server, options, operation, "sse"); }
      catch (fallbackError) {
        options.signal?.throwIfAborted();
        throw new AggregateError([primaryError, fallbackError], "Remote MCP HTTP and legacy SSE connection failed", { cause: primaryError });
      }
    }
    return await operation(client, limits);
  } finally {
    await client.close();
    transport.dispose();
    await transport.closed;
  }
}
