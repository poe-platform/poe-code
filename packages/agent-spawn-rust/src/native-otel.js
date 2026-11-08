import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { native } from "./native.js";
const planner = new native.NativeSpawnPlanner();
export async function startNativeOtelCapture(agentId, content = false) {
  if (!planner.telemetrySupported(agentId)) {
    console.warn(
      `warning: agent "${agentId}" does not emit OpenTelemetry; running without OTel capture`
    );
    return undefined;
  }
  const records = [];
  const server = createServer((request, response) => {
    void receive(request, response, records);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to start native OTel receiver");
  }
  const endpoint = `http://127.0.0.1:${address.port}`;
  console.warn(
    `OTel capture enabled: receiving OTLP from "${agentId}" at ${endpoint}${content ? " (including prompt and tool content)" : ""}`
  );
  const correlationId = randomUUID();
  const { env, args } = planner.telemetryPlan(agentId, endpoint, correlationId, content);
  return {
    env,
    args,
    correlationId,
    async drain() {
      await new Promise((resolve) => server.close(resolve));
      return records;
    }
  };
}
async function receive(request, response, records) {
  const signal = request.url === undefined ? undefined : native.spawnOtelSignal(request.url);
  const chunks = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (signal && body.length > 0) {
    const contentType = request.headers["content-type"];
    try {
      records.push({
        signal,
        ...(contentType ? { contentType } : {}),
        body: contentType?.includes("json")
          ? JSON.parse(body.toString("utf8"))
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
