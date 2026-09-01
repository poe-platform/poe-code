import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { collectBytes, toByteSource, type ByteSink, type ByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createCurlCommand, type NetworkCommandsOptions } from "../../../src/commands/network/index.js";

export async function fixture(): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  return fs;
}

export interface RunOptions {
  fs?: FileSystem;
  stdin?: string | Uint8Array | ByteSource;
  signal?: AbortSignal;
  stdout?: ByteSink;
  options?: Partial<NetworkCommandsOptions>;
}

export async function run(args: readonly string[], options: RunOptions = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const fs = options.fs ?? await fixture();
  const context: CommandContext = {
    command: "curl", args, cwd: "/work", env: { HTTP_PROXY: "http://untrusted.invalid", HOME: "/never-read" }, fs,
    signal: options.signal ?? new AbortController().signal,
    stdin: typeof options.stdin === "string" || options.stdin instanceof Uint8Array || options.stdin === undefined
      ? toByteSource(options.stdin ?? "") : options.stdin,
    stdout: options.stdout ?? { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  };
  const result = await createCurlCommand({
    authorize: request => new URL(request.url).hostname === "127.0.0.1", ...options.options,
  }).execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), fs };
}

export interface TestServer {
  origin: string;
  requests: { method: string; path: string; headers: IncomingMessage["headers"]; body: Buffer }[];
  closedStreams: number;
  retries: Map<string, number>;
  close(): Promise<void>;
}

export async function server(extra?: (request: IncomingMessage, response: ServerResponse) => boolean): Promise<TestServer> {
  const state: TestServer = { origin: "", requests: [], closedStreams: 0, retries: new Map(), async close() {} };
  const pending = new Set<Promise<void>>();
  const native = createServer((request, response) => {
    response.sendDate = false;
    response.setHeader("Connection", "close");
    const operation = (async () => {
      const path = request.url ?? "/";
      if (extra?.(request, response)) return;
      if (path === "/slow") { response.on("close", () => state.closedStreams++); return; }
      if (path === "/stream") {
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        const timer = setInterval(() => { response.write(Buffer.alloc(8192, 65)); }, 5);
        response.on("close", () => { clearInterval(timer); state.closedStreams++; });
        return;
      }
      const body = Buffer.from(await collectBytes(request, { maxBytes: 2 * 1024 * 1024 }));
      state.requests.push({ method: request.method ?? "", path, headers: { ...request.headers }, body });
      if (path === "/bytes") { response.setHeader("Content-Type", "application/octet-stream"); response.end(Buffer.from([0, 255, 195, 169, 10, 13, 128])); return; }
      if (path === "/fail") { response.writeHead(418, { "Content-Type": "text/plain" }); response.end("teapot\n"); return; }
      if (/^\/redirect\/(301|302|303|307|308)$/.test(path)) {
        response.writeHead(Number(path.split("/")[2]), { Location: "/echo" }); response.end("redirected"); return;
      }
      if (path === "/loop") { response.writeHead(302, { Location: "/loop" }); response.end(); return; }
      if (path.startsWith("/retry")) {
        const count = (state.retries.get(path) ?? 0) + 1; state.retries.set(path, count);
        if (count < 3) { response.writeHead(503, { "Retry-After": "0" }); response.end("retry"); return; }
        response.end("recovered"); return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ method: request.method, path, body: body.toString("hex"),
        contentType: request.headers["content-type"] ?? null, authorization: request.headers.authorization ?? null,
        custom: request.headers["x-test"] ?? null, cookie: request.headers.cookie ?? null }));
    })();
    pending.add(operation);
    void operation.catch(() => response.destroy()).finally(() => pending.delete(operation));
  });
  native.requestTimeout = 5000;
  await new Promise<void>((resolve, reject) => { native.once("error", reject); native.listen(0, "127.0.0.1", resolve); });
  const address = native.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  state.origin = `http://127.0.0.1:${address.port}`;
  state.close = async () => {
    await new Promise<void>((resolve, reject) => { native.close(error => error ? reject(error) : resolve()); native.closeAllConnections(); });
    await Promise.allSettled(pending);
  };
  return state;
}
