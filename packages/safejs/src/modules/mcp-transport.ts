import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  HttpTransport,
  McpClient,
  StdioTransport,
  type HttpTransportFetch,
  type McpTransport,
  type StdioSpawn
} from "tiny-mcp-client";

export type McpServerConfig =
  | { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  | { url: string; headers?: Record<string, string> };

export type McpModuleOptions = {
  servers: Record<string, McpServerConfig>;
  requestTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxToolPages?: number;
  signal?: AbortSignal;
  fetch?: HttpTransportFetch;
  spawn?: StdioSpawn;
};

export type ManagedMcpConnection = {
  ready: Promise<McpClient>;
  close(): Promise<void>;
};

export function parseMcpConfig(source: string, directory: string): McpModuleOptions {
  const parsed = JSON.parse(source) as unknown;
  const options = normalizeMcpOptions(parsed, [
    "servers",
    "requestTimeoutMs",
    "closeTimeoutMs",
    "maxToolPages"
  ]);
  for (const server of Object.values(options.servers)) {
    if ("command" in server) {
      server.cwd = path.resolve(directory, server.cwd ?? ".");
      if (server.command.includes("/") || server.command.includes("\\")) {
        server.command = path.resolve(directory, server.command);
      }
    }
  }
  return options;
}

export function normalizeMcpOptions(
  value: unknown,
  keys = [
    "servers",
    "requestTimeoutMs",
    "closeTimeoutMs",
    "maxToolPages",
    "signal",
    "fetch",
    "spawn"
  ]
): McpModuleOptions {
  const options = readRecord(value, "MCP options", keys);
  const servers = readRecord(options.servers, "MCP servers");
  const normalized = Object.create(null) as Record<string, McpServerConfig>;
  for (const [name, input] of Object.entries(servers)) {
    if (name.length === 0 || name.trim() !== name)
      throw new TypeError("MCP server names must be non-empty without surrounding whitespace.");
    const server = readRecord(input, `MCP server ${name}`);
    if (Object.hasOwn(server, "command")) {
      readRecord(server, `MCP server ${name}`, ["command", "args", "cwd", "env"]);
      const command = readText(server.command, "MCP command");
      if (
        server.args !== undefined &&
        (!Array.isArray(server.args) ||
          server.args.some((argument) => typeof argument !== "string"))
      )
        throw new TypeError("MCP args must be an array of strings.");
      normalized[name] = {
        command,
        ...(server.args === undefined ? {} : { args: [...(server.args as string[])] }),
        ...(server.cwd === undefined ? {} : { cwd: readText(server.cwd, "MCP cwd") }),
        env: readStrings(server.env ?? {}, "MCP environment")
      };
    } else {
      readRecord(server, `MCP server ${name}`, ["url", "headers"]);
      const url = new URL(readText(server.url, "MCP URL"));
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
        throw new TypeError("MCP URL must use HTTP or HTTPS without credentials or a fragment.");
      const headers = readStrings(server.headers ?? {}, "MCP headers");
      new Headers(headers);
      normalized[name] = { url: url.href, headers };
    }
  }
  for (const name of ["fetch", "spawn"])
    if (options[name] !== undefined && typeof options[name] !== "function")
      throw new TypeError(`MCP ${name} must be a function.`);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new TypeError("MCP signal must be an AbortSignal.");
  return {
    servers: normalized,
    requestTimeoutMs: readTimeout(options.requestTimeoutMs, 30_000),
    closeTimeoutMs: readTimeout(options.closeTimeoutMs, 1_000),
    maxToolPages: readTimeout(options.maxToolPages, 100),
    ...(options.signal === undefined ? {} : { signal: options.signal as AbortSignal }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch as HttpTransportFetch }),
    ...(options.spawn === undefined ? {} : { spawn: options.spawn as StdioSpawn })
  };
}

function readRecord(value: unknown, label: string, keys?: string[]): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError(`${label} must be a plain object.`);
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || (keys !== undefined && !keys.includes(key)))
      throw new TypeError(`${label} contains unsupported field ${key}.`);
    result[key] = descriptor.value;
  }
  return result;
}

function readText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0"))
    throw new TypeError(`${label} must be a non-empty string without NUL characters.`);
  return value;
}

function readStrings(value: unknown, label: string): Record<string, string> {
  const entries = readRecord(value, label);
  for (const [name, entry] of Object.entries(entries))
    if (typeof entry !== "string" || name.includes("\0") || entry.includes("\0"))
      throw new TypeError(`${label} must contain strings without NUL characters.`);
  return entries as Record<string, string>;
}

function readTimeout(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 2_147_483_647
  )
    throw new TypeError("MCP timeouts must be positive 32-bit integers.");
  return value;
}

export function connectMcpTransport(
  server: McpServerConfig,
  options: McpModuleOptions,
  signal?: AbortSignal
): ManagedMcpConnection {
  signal?.throwIfAborted();
  options.signal?.throwIfAborted();
  const client = new McpClient({
    clientInfo: { name: "safejs", version: "1" },
    requestTimeoutMs: options.requestTimeoutMs
  });
  let child: ChildProcessWithoutNullStreams | undefined;
  const activeRequests = new Set<AbortController>();
  const transport: McpTransport =
    "command" in server
      ? new StdioTransport({
          ...server,
          spawn(command, args, spawnOptions) {
            child =
              options.spawn === undefined
                ? (spawn(command, args, spawnOptions) as ChildProcessWithoutNullStreams)
                : options.spawn(command, args, spawnOptions);
            return child;
          }
        })
      : new HttpTransport({
          ...server,
          async fetch(input, init) {
            const controller = new AbortController();
            activeRequests.add(controller);
            const cancel = () => controller.abort(init?.signal?.reason);
            init?.signal?.addEventListener("abort", cancel, { once: true });
            if (init?.signal?.aborted) cancel();
            const timeout = setTimeout(
              () => controller.abort(new Error("MCP HTTP request timed out.")),
              init?.method === "DELETE" ? options.closeTimeoutMs : options.requestTimeoutMs
            );
            const finish = () => {
              clearTimeout(timeout);
              activeRequests.delete(controller);
              init?.signal?.removeEventListener("abort", cancel);
            };
            try {
              const response = await (options.fetch ?? fetch)(input, {
                ...init,
                signal: controller.signal,
                redirect: "error"
              });
              if (response.body === null) {
                finish();
                return response;
              }
              const reader = response.body.getReader();
              let stopReading: (() => void) | undefined;
              const release = () => {
                finish();
                if (stopReading !== undefined)
                  controller.signal.removeEventListener("abort", stopReading);
              };
              const body = new ReadableStream<Uint8Array>({
                start(stream) {
                  stopReading = () => {
                    void reader.cancel(controller.signal.reason).catch(() => undefined);
                    stream.error(controller.signal.reason);
                    release();
                  };
                  controller.signal.addEventListener("abort", stopReading, { once: true });
                  if (controller.signal.aborted) stopReading();
                },
                async pull(stream) {
                  try {
                    const result = await reader.read();
                    if (controller.signal.aborted) return;
                    if (result.done) {
                      release();
                      stream.close();
                    } else stream.enqueue(result.value);
                  } catch (error) {
                    release();
                    stream.error(error);
                  }
                },
                async cancel(reason) {
                  release();
                  await reader.cancel(reason);
                }
              });
              return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
            } catch (error) {
              finish();
              throw error;
            }
          }
        });
  let closing: Promise<void> | undefined;
  const cancel = () => {
    void close().catch(() => undefined);
  };
  function close(): Promise<void> {
    closing ??= (async () => {
      signal?.removeEventListener("abort", cancel);
      options.signal?.removeEventListener("abort", cancel);
      for (const request of activeRequests) request.abort(new Error("MCP connection closed."));
      await client.close();
      transport.dispose();
      await new Promise<void>((resolve, reject) => {
        let forced: ReturnType<typeof setTimeout> | undefined;
        const timeout = setTimeout(() => {
          if (child !== undefined && child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
          forced = setTimeout(
            () => reject(new Error("MCP transport did not close.")),
            options.closeTimeoutMs
          );
        }, options.closeTimeoutMs);
        void transport.closed.then(
          () => {
            clearTimeout(timeout);
            clearTimeout(forced);
            resolve();
          },
          (error) => {
            clearTimeout(timeout);
            clearTimeout(forced);
            reject(error);
          }
        );
      });
    })();
    return closing;
  }
  signal?.addEventListener("abort", cancel, { once: true });
  options.signal?.addEventListener("abort", cancel, { once: true });
  const aborted = signal?.aborted || options.signal?.aborted;
  if (aborted) cancel();
  const connecting = aborted
    ? Promise.reject(signal?.aborted ? signal.reason : options.signal?.reason)
    : client.connect(transport);
  const ready = connecting.then(
    () => client,
    async (error) => {
      await close().catch(() => undefined);
      throw signal?.aborted
        ? signal.reason
        : options.signal?.aborted
          ? options.signal.reason
          : error;
    }
  );
  return { ready, close };
}
