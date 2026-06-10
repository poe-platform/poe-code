import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { allAgents, resolveAgentId } from "@poe-code/agent-defs";

export interface NativeOtelRecord {
  signal: "traces" | "logs" | "metrics";
  contentType?: string;
  body: Record<string, unknown> | string;
}

export interface NativeOtelCapture {
  env: Record<string, string>;
  args: string[];
  correlationId: string;
  drain(): Promise<NativeOtelRecord[]>;
}

export async function startNativeOtelCapture(
  agentId: string,
  content = false
): Promise<NativeOtelCapture | undefined> {
  const resolvedId = resolveAgentId(agentId);
  const definition = allAgents.find((agent) => agent.id === resolvedId)?.otelCapture;
  if (!definition) {
    console.warn(`warning: agent "${agentId}" does not emit OpenTelemetry; running without OTel capture`);
    return undefined;
  }

  const records: NativeOtelRecord[] = [];
  const server = createServer((request, response) => {
    void receive(request, response, records);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to start native OTel receiver");
  }

  const endpoint = `http://127.0.0.1:${address.port}`;
  const correlationId = randomUUID();
  const env = {
    ...(definition.env ?? {}),
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_RESOURCE_ATTRIBUTES: `poe.code.spawn.id=${correlationId}`,
    ...(content
      ? {
          OTEL_LOG_USER_PROMPTS: "1",
          OTEL_LOG_TOOL_CONTENT: "1",
          OTEL_LOG_TOOL_DETAILS: "1"
        }
      : {})
  };

  return {
    env,
    args: definition.args?.(endpoint, content) ?? [],
    correlationId,
    async drain(): Promise<NativeOtelRecord[]> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return records;
    }
  };
}

async function receive(
  request: IncomingMessage,
  response: ServerResponse,
  records: NativeOtelRecord[]
): Promise<void> {
  const signal = readSignal(request.url);
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  if (signal && body.length > 0) {
    const contentType = request.headers["content-type"];
    try {
      records.push({
        signal,
        ...(contentType ? { contentType } : {}),
        body: contentType?.includes("json")
          ? (JSON.parse(body.toString("utf8")) as Record<string, unknown>)
          : body.toString("base64")
      });
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }
  }
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end("{}");
}

function readSignal(url: string | undefined): NativeOtelRecord["signal"] | undefined {
  if (url?.endsWith("/v1/traces")) return "traces";
  if (url?.endsWith("/v1/logs")) return "logs";
  if (url?.endsWith("/v1/metrics")) return "metrics";
  return undefined;
}
