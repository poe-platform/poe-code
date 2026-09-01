import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { vol } from "memfs";
import { installInMemoryHttp, nodeFetch } from "tiny-http-mcp-server/test-support";

installInMemoryHttp();

const fsHooks = vi.hoisted(() => ({
  appendFile: undefined as undefined | (() => Promise<void>),
  writeFile: undefined as undefined | ((targetPath: string, options?: unknown) => Promise<void>)
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    appendFile: async (...args: Parameters<typeof fs.promises.appendFile>) => {
      if (fsHooks.appendFile) {
        await fsHooks.appendFile();
      }
      return await fs.promises.appendFile(...args);
    },
    writeFile: async (...args: Parameters<typeof fs.promises.writeFile>) => {
      if (fsHooks.writeFile) {
        await fsHooks.writeFile(String(args[0]), args[2]);
      }
      return await fs.promises.writeFile(...args);
    }
  };
});

import { startProxyServer } from "./proxy-server.js";
import type { CapturedExchange } from "./proxy-types.js";
import "./matchers.js";

function installNodeFetchMock(): void {
  const fetchImpl: typeof fetch = async (input, init) => {
    if (input instanceof Request) {
      return nodeFetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: input.signal,
        ...init
      });
    }

    return nodeFetch(input, init);
  };
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
}

interface DummyApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isCapturedExchange(value: unknown): value is CapturedExchange {
  if (!isObjectRecord(value)) {
    return false;
  }
  if (typeof value.timestamp !== "string") {
    return false;
  }
  if (typeof value.route !== "string") {
    return false;
  }
  if (!isObjectRecord(value.request) || !isObjectRecord(value.response)) {
    return false;
  }
  if (typeof value.request.method !== "string") {
    return false;
  }
  if (typeof value.request.path !== "string") {
    return false;
  }
  if (!isObjectRecord(value.request.headers)) {
    return false;
  }
  if (typeof value.response.status !== "number") {
    return false;
  }

  return "body" in value.request && "body" in value.response;
}

function sanitizeModelName(model: string): string {
  const lower = model.toLowerCase();
  let result = "";
  for (const char of lower) {
    const code = char.charCodeAt(0);
    const isAlpha = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (isAlpha || isDigit || char === "-") {
      result += char;
      continue;
    }

    result += "-";
  }

  return result;
}

function generateSnapshotKey(request: {
  model: string;
  messages: Array<{ role: string; content: string }>;
}): string {
  const normalized = JSON.stringify({
    model: request.model,
    messages: request.messages
  });
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `${sanitizeModelName(request.model)}-${hash}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function parseBody(body: string): unknown {
  if (body.trim() === "") {
    return "";
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(Object.prototype, key, descriptor);
      } else {
        delete (Object.prototype as Record<string, unknown>)[key];
      }
    }
  }
}

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine server port");
  }

  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function startDummyApi(port: number) {
  let lastRequest: DummyApiRequest | null = null;
  const server = createServer(async (req, res) => {
    const requestBody = parseBody(await readBody(req));
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;

    lastRequest = {
      method: req.method ?? "GET",
      path: requestPath,
      headers: req.headers,
      body: requestBody
    };

    const messageContent =
      isObjectRecord(requestBody) &&
      Array.isArray(requestBody.messages) &&
      requestBody.messages.length > 0 &&
      isObjectRecord(requestBody.messages[requestBody.messages.length - 1]) &&
      typeof requestBody.messages[requestBody.messages.length - 1].content === "string"
        ? requestBody.messages[requestBody.messages.length - 1].content
        : "empty";
    const model =
      isObjectRecord(requestBody) && typeof requestBody.model === "string"
        ? requestBody.model
        : "dummy-model";

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: `chatcmpl-dummy-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: `Echo: ${messageContent}`
            },
            finish_reason: "stop"
          }
        ]
      })
    );
  });

  const boundPort = await listen(server, port);

  return {
    url: `http://127.0.0.1:${boundPort}`,
    getLastRequest: () => lastRequest,
    close: async () => {
      await close(server);
    }
  };
}

async function findAvailablePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
}

describe("startDummyApi", () => {
  const closeHandles: Array<() => Promise<void>> = [];

  beforeEach(() => {
    fsHooks.appendFile = undefined;
    fsHooks.writeFile = undefined;
    installNodeFetchMock();
  });

  afterEach(async () => {
    while (closeHandles.length > 0) {
      const closeHandle = closeHandles.pop();
      if (closeHandle) {
        await closeHandle();
      }
    }
  });

  it("starts on the specified port and returns lifecycle handles", async () => {
    const port = await findAvailablePort();
    const dummyApi = await startDummyApi(port);
    closeHandles.push(dummyApi.close);

    expect(dummyApi.url).toBe(`http://127.0.0.1:${port}`);
    expect(dummyApi.close).toEqual(expect.any(Function));
  });

  it("echoes the last message content in ChatCompletionResponse format", async () => {
    const dummyApi = await startDummyApi(0);
    closeHandles.push(dummyApi.close);

    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "hello from test" }
      ]
    };

    const response = await fetch(`${dummyApi.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: expect.any(String),
      object: "chat.completion",
      created: expect.any(Number),
      model: "Claude-Sonnet-4.5",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Echo: hello from test" },
          finish_reason: "stop"
        }
      ]
    });
  });
});

describe("startProxyServer playback mode with onMiss passthrough", () => {
  const captureFile = "/tmp/proxy-capture.jsonl";
  const closeHandles: Array<() => Promise<void>> = [];

  beforeEach(() => {
    fsHooks.appendFile = undefined;
    fsHooks.writeFile = undefined;
    vol.reset();
    vol.mkdirSync("/tmp", { recursive: true });
    closeHandles.length = 0;
    installNodeFetchMock();
  });

  afterEach(async () => {
    while (closeHandles.length > 0) {
      const closeHandle = closeHandles.pop();
      if (closeHandle) {
        await closeHandle();
      }
    }
  });

  it("forwards requests to route.target and returns the upstream response", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "dummy-model",
      messages: [{ role: "user", content: "hello proxy" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "chat.completion",
      model: "dummy-model",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Echo: hello proxy"
          }
        }
      ]
    });
  });

  it("strips content-encoding and transfer-encoding from upstream response", async () => {
    const gzipServer = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.setHeader("content-encoding", "gzip");
      res.setHeader("transfer-encoding", "chunked");
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });
    const gzipPort = await listen(gzipServer);
    closeHandles.push(async () => {
      await close(gzipServer);
    });

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1", target: `http://127.0.0.1:${gzipPort}`, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }] })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("transfer-encoding")).toBeNull();
    const body = await response.json();
    expect(body).toEqual({ choices: [{ message: { content: "ok" } }] });
  });

  it("captures request/response bodies, path, and timestamp as JSONL", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "dummy-model",
      messages: [{ role: "user", content: "capture this exchange" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const responseBody = await response.json();
    const captureContent = vol.readFileSync(captureFile, "utf8") as string;
    const lines = captureContent.trim().split("\n");
    const captured = JSON.parse(lines[0]) as unknown;

    expect(lines).toHaveLength(1);
    expect(isCapturedExchange(captured)).toBe(true);
    if (!isCapturedExchange(captured)) {
      return;
    }

    expect(captured.request.path).toBe("/v1/chat/completions");
    expect(captured).toHaveRequestBody(payload);
    expect(captured).toHaveResponseBody(responseBody as Record<string, unknown>);
    expect(Number.isNaN(Date.parse(captured.timestamp))).toBe(false);
  });

  it("writes one parseable JSONL line per exchange for multiple requests", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    const payloads = [
      {
        model: "dummy-model",
        messages: [{ role: "user", content: "first request" }]
      },
      {
        model: "dummy-model",
        messages: [{ role: "user", content: "second request" }]
      },
      {
        model: "dummy-model",
        messages: [{ role: "user", content: "third request" }]
      }
    ];
    const responseBodies: unknown[] = [];

    for (const payload of payloads) {
      const response = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      responseBodies.push(await response.json());
    }

    const captureContent = vol.readFileSync(captureFile, "utf8") as string;
    const lines = captureContent.trim().split("\n");

    expect(lines).toHaveLength(3);

    for (const [index, line] of lines.entries()) {
      const captured = JSON.parse(line) as unknown;
      expect(isCapturedExchange(captured)).toBe(true);
      if (!isCapturedExchange(captured)) {
        continue;
      }

      expect(Number.isNaN(Date.parse(captured.timestamp))).toBe(false);
      expect(new Date(captured.timestamp).toISOString()).toBe(captured.timestamp);
      expect(captured.request.body).toEqual(payloads[index]);
      expect(typeof captured.request.body).toBe("object");
      expect(captured.response.body).toEqual(responseBodies[index]);
      expect(typeof captured.response.body).toBe("object");
    }
  });

  it("preserves Authorization and Content-Type headers when forwarding", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    await nodeFetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "proxy-authorization": "Basic proxy-secret",
        "content-type": "application/json",
        cookie: "session=secret-cookie",
        "x-api-key": "api-key-secret",
        "x-session-token": "session-token-secret",
        "x-safe-header": "safe-value"
      },
      body: JSON.stringify({
        model: "dummy-model",
        messages: [{ role: "user", content: "check headers" }]
      })
    });

    const request = upstream.getLastRequest();
    expect(request?.headers.authorization).toBe("Bearer test-token");
    expect(request?.headers["proxy-authorization"]).toBe("Basic proxy-secret");
    expect(request?.headers.cookie).toBe("session=secret-cookie");
    expect(request?.headers["x-api-key"]).toBe("api-key-secret");
    expect(request?.headers["x-session-token"]).toBe("session-token-secret");
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers["x-safe-header"]).toBe("safe-value");

    const captureContent = vol.readFileSync(captureFile, "utf8") as string;
    const captured = JSON.parse(captureContent.trim()) as CapturedExchange;
    expect(captured.request.headers.authorization).toBe("[redacted]");
    expect(captured.request.headers["proxy-authorization"]).toBe("[redacted]");
    expect(captured.request.headers.cookie).toBe("[redacted]");
    expect(captured.request.headers["x-api-key"]).toBe("[redacted]");
    expect(captured.request.headers["x-session-token"]).toBe("[redacted]");
    expect(captured.request.headers["content-type"]).toBe("application/json");
    expect(captured.request.headers["x-safe-header"]).toBe("safe-value");
    expect(JSON.stringify(captured)).not.toContain("test-token");
    expect(JSON.stringify(captured)).not.toContain("proxy-secret");
    expect(JSON.stringify(captured)).not.toContain("api-key-secret");
    expect(JSON.stringify(captured)).not.toContain("session-token-secret");
  });

  it("uses the first matching route when multiple route prefixes match", async () => {
    const firstUpstream = await startDummyApi(0);
    const secondUpstream = await startDummyApi(0);
    closeHandles.push(firstUpstream.close, secondUpstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [
        { path: "/v1/chat", target: firstUpstream.url, mode: "playback" },
        { path: "/v1", target: secondUpstream.url, mode: "playback" }
      ]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "dummy-model",
      messages: [{ role: "user", content: "first match wins" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    expect(firstUpstream.getLastRequest()?.path).toBe("/v1/chat/completions");
    expect(secondUpstream.getLastRequest()).toBeNull();
  });

  it("matches routes by path prefix", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1/chat", target: upstream.url, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "dummy-model",
      messages: [{ role: "user", content: "prefix match" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    expect(upstream.getLastRequest()?.path).toBe("/v1/chat/completions");
  });

  it("does not match sibling paths that share the same route prefix text", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/v10/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "dummy-model", messages: [] })
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "No matching proxy route for /v10/chat/completions"
    });
    expect(upstream.getLastRequest()).toBeNull();
  });

  it("does not match routes with non-prefix paths", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [
        {
          path: "/v1/chat/completions",
          target: upstream.url,
          mode: "playback"
        }
      ]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/v1/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "dummy-model", messages: [] })
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "No matching proxy route for /v1/models"
    });
    expect(upstream.getLastRequest()).toBeNull();
  });

  it("returns 502 when no route matches the request path", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "passthrough",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback" }]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/unmatched/path`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "dummy-model", messages: [] })
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "No matching proxy route for /unmatched/path"
    });
  });
});

describe("startProxyServer record mode", () => {
  const captureFile = "/tmp/proxy-capture.jsonl";
  const snapshotDir = "/tmp/proxy-snapshots";
  const closeHandles: Array<() => Promise<void>> = [];

  beforeEach(() => {
    fsHooks.appendFile = undefined;
    fsHooks.writeFile = undefined;
    vol.reset();
    vol.mkdirSync("/tmp", { recursive: true });
    closeHandles.length = 0;
    installNodeFetchMock();
  });

  afterEach(async () => {
    while (closeHandles.length > 0) {
      const closeHandle = closeHandles.pop();
      if (closeHandle) {
        await closeHandle();
      }
    }
  });

  it("forwards to upstream and saves snapshot with expected key and payload", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: upstream.url, mode: "record", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "record this exchange" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const responseBody = await response.json();

    const upstreamRequest = upstream.getLastRequest();
    expect(upstreamRequest?.path).toBe("/v1/chat/completions");
    expect(upstreamRequest?.body).toEqual(payload);
    expect(response.status).toBe(200);
    expect(responseBody).toMatchObject({
      object: "chat.completion",
      model: payload.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: "Echo: record this exchange"
          }
        }
      ]
    });

    const key = generateSnapshotKey(payload);
    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          model: payload.model,
          messages: payload.messages
        })
      )
      .digest("hex")
      .slice(0, 12);
    const snapshotPath = join(snapshotDir, `${key}.json`);

    expect(key.endsWith(`-${expectedHash}`)).toBe(true);
    expect(vol.existsSync(snapshotPath)).toBe(true);

    const snapshotRaw = vol.readFileSync(snapshotPath, "utf8") as string;
    const snapshot = JSON.parse(snapshotRaw);
    expect(snapshot).toEqual({
      key,
      request: payload,
      response: responseBody,
      metadata: {
        recordedAt: expect.any(String)
      }
    });
    expect(Number.isNaN(Date.parse(snapshot.metadata.recordedAt))).toBe(false);
  });

  it("does not follow a preexisting legacy snapshot temp symlink", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);
    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "legacy temp path" }]
    };
    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);
    const legacyTemporaryPath = `${snapshotPath}.${process.pid}.1234.tmp`;
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.mkdirSync("/outside", { recursive: true });
    vol.writeFileSync("/outside/snapshot-tmp.json", "outside-state\n");
    vol.symlinkSync("/outside/snapshot-tmp.json", legacyTemporaryPath);
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);

    try {
      const proxy = await startProxyServer({
        port: 0,
        captureFile,
        onMiss: "error",
        routes: [{ path: "/v1", target: upstream.url, mode: "record", snapshotDir }]
      });
      closeHandles.push(proxy.close);

      const response = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const responseBody = await response.json();

      expect(response.status).toBe(200);
      expect(vol.readFileSync("/outside/snapshot-tmp.json", "utf8")).toBe("outside-state\n");
      expect(vol.lstatSync(legacyTemporaryPath).isSymbolicLink()).toBe(true);
      expect(vol.lstatSync(snapshotPath).isSymbolicLink()).toBe(false);
      expect(JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string).response).toEqual(
        responseBody
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("uses the generated snapshot key as the file name", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: upstream.url, mode: "record", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "same payload, deterministic key" }]
    };

    await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const expectedKey = generateSnapshotKey(payload);
    const snapshotFiles = vol.readdirSync(snapshotDir) as string[];

    expect(snapshotFiles).toContain(`${expectedKey}.json`);
  });

  it("writes snapshot contents with key, request, response, and metadata.recordedAt", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: upstream.url, mode: "record", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "inspect snapshot payload" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const responseBody = await response.json();

    const key = generateSnapshotKey(payload);
    const snapshotRaw = vol.readFileSync(join(snapshotDir, `${key}.json`), "utf8") as string;
    const snapshot = JSON.parse(snapshotRaw);

    expect(snapshot.key).toBe(key);
    expect(snapshot.request).toEqual(payload);
    expect(snapshot.response).toEqual(responseBody);
    expect(snapshot.metadata.recordedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(snapshot.metadata.recordedAt))).toBe(false);
  });

  it("overwrites the same snapshot when recording the same request body twice", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: upstream.url, mode: "record", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "idempotent snapshot key" }]
    };
    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);

    await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    vol.writeFileSync(
      snapshotPath,
      JSON.stringify({
        key,
        request: payload,
        response: { manuallyOverwritten: true },
        metadata: { recordedAt: "2000-01-01T00:00:00.000Z" }
      })
    );

    const secondResponse = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const secondResponseBody = await secondResponse.json();
    const snapshotRaw = vol.readFileSync(snapshotPath, "utf8") as string;
    const snapshot = JSON.parse(snapshotRaw);
    const snapshotFiles = vol.readdirSync(snapshotDir) as string[];

    expect(snapshotFiles).toEqual([`${key}.json`]);
    expect(snapshot.response).toEqual(secondResponseBody);
    expect(snapshot.response.manuallyOverwritten).toBeUndefined();
  });

  it("does not replace a prior snapshot when capture persistence fails", async () => {
    const payload = { model: "dummy-model", messages: [{ role: "user", content: "retry" }] };
    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(snapshotPath, JSON.stringify({ key, response: { id: "prior" } }));
    fsHooks.appendFile = async () => {
      throw new Error("capture failed");
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "fresh" }), { status: 200 })
    );
    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: "http://unused.test", mode: "record", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const response = await withObjectPrototypeProperties({ code: "EEXIST" }, async () =>
      nodeFetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      })
    );

    expect(response.status).toBe(502);
    expect(JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string).response).toEqual({
      id: "prior"
    });
  });

  it("preserves a prior snapshot when atomic replacement fails", async () => {
    const payload = { model: "dummy-model", messages: [{ role: "user", content: "retry" }] };
    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(snapshotPath, JSON.stringify({ key, response: { id: "prior" } }));
    fsHooks.writeFile = async (targetPath) => {
      if (targetPath !== snapshotPath) {
        throw new Error("snapshot failed");
      }
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "fresh" }), { status: 200 })
    );
    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: "http://unused.test", mode: "record", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const response = await nodeFetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(502);
    expect(JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string).response).toEqual({
      id: "prior"
    });
  });

  it("removes a partially written temporary snapshot when creation fails", async () => {
    const payload = { model: "dummy-model", messages: [{ role: "user", content: "retry" }] };
    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(snapshotPath, JSON.stringify({ key, response: { id: "prior" } }));
    let temporaryPath: string | undefined;
    fsHooks.writeFile = async (targetPath, options) => {
      if (targetPath.startsWith(`${snapshotPath}.`) && targetPath.endsWith(".tmp")) {
        temporaryPath = targetPath;
        vol.writeFileSync(targetPath, "{", options as Parameters<typeof vol.writeFileSync>[2]);
        throw new Error("snapshot disk full");
      }
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "fresh" }), { status: 200 })
    );
    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: "http://unused.test", mode: "record", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const response = await nodeFetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(502);
    expect(temporaryPath).toBeDefined();
    expect(vol.existsSync(temporaryPath as string)).toBe(false);
    expect(JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string).response).toEqual({
      id: "prior"
    });
  });
});

describe("startProxyServer playback mode", () => {
  const captureFile = "/tmp/proxy-capture.jsonl";
  const snapshotDir = "/tmp/proxy-snapshots";
  const closeHandles: Array<() => Promise<void>> = [];

  beforeEach(() => {
    fsHooks.appendFile = undefined;
    fsHooks.writeFile = undefined;
    vol.reset();
    vol.mkdirSync("/tmp", { recursive: true });
    closeHandles.length = 0;
    installNodeFetchMock();
  });

  afterEach(async () => {
    while (closeHandles.length > 0) {
      const closeHandle = closeHandles.pop();
      if (closeHandle) {
        await closeHandle();
      }
    }
  });

  it("returns snapshot response without contacting upstream", async () => {
    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "playback request" }]
    };
    const expectedBody = {
      id: "snapshot-chatcmpl-1",
      choices: [{ message: { role: "assistant", content: "served from snapshot" } }]
    };
    const key = generateSnapshotKey(payload);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(
      join(snapshotDir, `${key}.json`),
      JSON.stringify({
        key,
        request: payload,
        response: expectedBody,
        metadata: { recordedAt: "2026-02-26T00:00:00.000Z" }
      })
    );

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expectedBody);
  });

  it("returns 404 with key-specific error when snapshot is missing", async () => {
    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "missing snapshot" }]
    };
    const key = generateSnapshotKey(payload);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: `Snapshot not found for key ${key}`
    });
  });

  it("does not treat inherited ENOENT as a missing malformed snapshot", async () => {
    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "malformed snapshot" }]
    };
    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(snapshotPath, JSON.stringify({ key, request: payload }));

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const response = await withObjectPrototypeProperties({ code: "ENOENT" }, async () =>
      fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: `Snapshot ${snapshotPath} is missing response.`
    });
  });

  it("does not serve inherited snapshot responses", async () => {
    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "inherited snapshot response" }]
    };
    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(snapshotPath, JSON.stringify({ key, request: payload }));

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const response = await withObjectPrototypeProperties(
      { response: { id: "polluted" } },
      async () =>
        fetch(`${proxy.url}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: `Snapshot ${snapshotPath} is missing response.`
    });
  });

  it("captures exchange in JSONL while serving from snapshot", async () => {
    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "capture playback exchange" }]
    };
    const expectedBody = {
      id: "snapshot-chatcmpl-2",
      choices: [{ message: { role: "assistant", content: "captured in playback" } }]
    };
    const key = generateSnapshotKey(payload);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(
      join(snapshotDir, `${key}.json`),
      JSON.stringify({
        key,
        request: payload,
        response: expectedBody,
        metadata: { recordedAt: "2026-02-26T00:00:00.000Z" }
      })
    );

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const responseBody = await response.json();

    const captureContent = vol.readFileSync(captureFile, "utf8") as string;
    const lines = captureContent.trim().split("\n");
    const captured = JSON.parse(lines[0]);

    expect(response.status).toBe(200);
    expect(responseBody).toEqual(expectedBody);
    expect(lines).toHaveLength(1);
    expect(captured.request.path).toBe("/v1/chat/completions");
    expect(captured.request.body).toEqual(payload);
    expect(captured.response.status).toBe(200);
    expect(captured.response.body).toEqual(responseBody);
    expect(Number.isNaN(Date.parse(captured.timestamp))).toBe(false);
  });

  it("waits for capture persistence before completing playback responses", async () => {
    const payload = { model: "dummy-model", messages: [{ role: "user", content: "held" }] };
    const key = generateSnapshotKey(payload);
    const responseBody = { id: "saved" };
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(
      join(snapshotDir, `${key}.json`),
      JSON.stringify({ key, response: responseBody })
    );
    let releaseCapture: (() => void) | undefined;
    fsHooks.appendFile = async () => {
      await new Promise<void>((resolve) => {
        releaseCapture = resolve;
      });
    };
    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: "http://unused.test", mode: "playback", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    let settled = false;
    const pendingResponse = nodeFetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((response) => {
      settled = true;
      return response;
    });
    await vi.waitFor(() => expect(releaseCapture).toEqual(expect.any(Function)));
    expect(settled).toBe(false);

    releaseCapture!();
    const response = await pendingResponse;
    expect(response.status).toBe(200);
  });

  it("uses the same key for same model and messages", async () => {
    const basePayload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "deterministic key" }]
    };
    const payloadWithTemperature = {
      ...basePayload,
      temperature: 0.1
    };
    const payloadWithStream = {
      ...basePayload,
      stream: true
    };
    const expectedKey = generateSnapshotKey(basePayload);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const firstResponse = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadWithTemperature)
    });
    const secondResponse = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadWithStream)
    });

    expect(firstResponse.status).toBe(404);
    expect(secondResponse.status).toBe(404);
    await expect(firstResponse.json()).resolves.toEqual({
      error: `Snapshot not found for key ${expectedKey}`
    });
    await expect(secondResponse.json()).resolves.toEqual({
      error: `Snapshot not found for key ${expectedKey}`
    });
  });

  it("uses different keys when messages differ", async () => {
    const firstPayload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "first deterministic message" }]
    };
    const secondPayload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "second deterministic message" }]
    };
    const firstKey = generateSnapshotKey(firstPayload);
    const secondKey = generateSnapshotKey(secondPayload);

    expect(firstKey).not.toBe(secondKey);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const firstResponse = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(firstPayload)
    });
    const secondResponse = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(secondPayload)
    });

    expect(firstResponse.status).toBe(404);
    expect(secondResponse.status).toBe(404);
    await expect(firstResponse.json()).resolves.toEqual({
      error: `Snapshot not found for key ${firstKey}`
    });
    await expect(secondResponse.json()).resolves.toEqual({
      error: `Snapshot not found for key ${secondKey}`
    });
  });
});

describe("startProxyServer playback mode with onMiss warn", () => {
  const captureFile = "/tmp/proxy-capture.jsonl";
  const snapshotDir = "/tmp/proxy-snapshots";
  const closeHandles: Array<() => Promise<void>> = [];

  beforeEach(() => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    onTestFinished(() => stderr.mockRestore());
    vol.reset();
    vol.mkdirSync("/tmp", { recursive: true });
    closeHandles.length = 0;
    installNodeFetchMock();
  });

  afterEach(async () => {
    while (closeHandles.length > 0) {
      const closeHandle = closeHandles.pop();
      if (closeHandle) {
        await closeHandle();
      }
    }
  });

  it("forwards to upstream on miss and logs warning", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "warn",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "dummy-model",
      messages: [{ role: "user", content: "warn on miss" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      choices: [{ message: { content: "Echo: warn on miss" } }]
    });
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("[proxy] snapshot miss:")
    );
  });

  it("does not save snapshot on miss", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "warn",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "dummy-model",
      messages: [{ role: "user", content: "no save on warn" }]
    };

    await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(vol.existsSync(snapshotDir)).toBe(false);
  });
});

describe("startProxyServer playback mode with onMiss record", () => {
  const captureFile = "/tmp/proxy-capture.jsonl";
  const snapshotDir = "/tmp/proxy-snapshots";
  const closeHandles: Array<() => Promise<void>> = [];

  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/tmp", { recursive: true });
    closeHandles.length = 0;
    installNodeFetchMock();
  });

  afterEach(async () => {
    while (closeHandles.length > 0) {
      const closeHandle = closeHandles.pop();
      if (closeHandle) {
        await closeHandle();
      }
    }
  });

  it("forwards to upstream and saves snapshot on miss", async () => {
    const upstream = await startDummyApi(0);
    closeHandles.push(upstream.close);

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "record",
      routes: [{ path: "/v1", target: upstream.url, mode: "playback", snapshotDir }]
    });
    closeHandles.push(proxy.close);

    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "record on miss" }]
    };

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      choices: [{ message: { content: "Echo: record on miss" } }]
    });

    const key = generateSnapshotKey(payload);
    const snapshotPath = join(snapshotDir, `${key}.json`);
    expect(vol.existsSync(snapshotPath)).toBe(true);

    const snapshot = JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string);
    expect(snapshot.key).toBe(key);
    expect(snapshot.request).toEqual(payload);
    expect(snapshot.metadata.recordedAt).toEqual(expect.any(String));
  });

  it("serves from snapshot on hit without contacting upstream", async () => {
    const payload = {
      model: "Claude-Sonnet-4.5",
      messages: [{ role: "user", content: "already cached" }]
    };
    const expectedBody = { choices: [{ message: { content: "from cache" } }] };
    const key = generateSnapshotKey(payload);
    vol.mkdirSync(snapshotDir, { recursive: true });
    vol.writeFileSync(
      join(snapshotDir, `${key}.json`),
      JSON.stringify({
        key,
        request: payload,
        response: expectedBody,
        metadata: { recordedAt: "2026-02-26T00:00:00.000Z" }
      })
    );

    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "record",
      routes: [
        {
          path: "/v1",
          target: "http://127.0.0.1:1",
          mode: "playback",
          snapshotDir
        }
      ]
    });
    closeHandles.push(proxy.close);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expectedBody);
  });
});
