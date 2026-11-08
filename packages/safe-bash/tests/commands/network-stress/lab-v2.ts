import assert from "node:assert/strict";
import { closeResources } from "./close-resources.js";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { binary } from "./rows.js";

export interface Trace {
  origin: string;
  method: string;
  path: string;
  headers: [string, string][];
  body: string;
}

export interface Lab {
  origins: Readonly<Record<"A" | "B" | "H", string>>;
  traces: Trace[];
  expand(value: string, root: string): string;
  normalize(value: string, root?: string): string;
  allow(url: string): boolean;
  waitForRequest(): Promise<void>;
  waitForIdle(): Promise<void>;
  close(): Promise<void>;
}

export async function createLab(): Promise<Lab> {
  const traces: Trace[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const origins = { A: "", B: "", H: "" };
  let requestObserved: (() => void) | undefined;
  const requested = new Promise<void>((resolve) => { requestObserved = resolve; });
  const later = (callback: () => void, delay: number): void => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  };
  const reply = (response: ServerResponse, status: number, body: Buffer, location?: string): void => {
    response.sendDate = false;
    response.writeHead(status, {
      "Content-Length": String(body.length),
      "Content-Type": "application/octet-stream",
      "X-Fixture": "independent-curl-v1",
      ...(location === undefined ? {} : { Location: location }),
      Connection: "close",
    });
    response.end(body);
  };
  const servers: Server[] = [];
  try {
    for (const origin of ["A", "B"] as const) {
      const server = createServer((request, response) => {
        void (async () => {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += Buffer.byteLength(chunk);
            if (size > 1024 * 1024) throw new Error("Fixture upload budget exceeded");
            chunks.push(Buffer.from(chunk));
          }
          const headers: [string, string][] = [];
          for (let index = 0; index < request.rawHeaders.length; index += 2) {
            headers.push([request.rawHeaders[index]!, request.rawHeaders[index + 1]!]);
          }
          const path = request.url ?? "/";
          traces.push({ origin, method: request.method ?? "", path, headers, body: Buffer.concat(chunks).toString("base64") });
          requestObserved?.();
          if (path === "/hang") return;
          if (path === "/stall" || path === "/partial" || path === "/stream") {
            response.sendDate = false;
            response.writeHead(200, { "Content-Length": path === "/stream" ? "1048576" : "100", Connection: "close" });
            response.write(Buffer.from("prefix\n"));
            if (path === "/partial") later(() => response.destroy(), 50);
            if (path === "/stream") {
              let sent = 7;
              const pump = (): void => {
                if (response.destroyed) return;
                const chunk = Buffer.alloc(Math.min(4096, 1048576 - sent), 120);
                sent += chunk.length;
                response.write(chunk);
                if (sent === 1048576) response.end();
                else later(pump, 5);
              };
              later(pump, 20);
            }
            return;
          }
          if (path.startsWith("/redirect/")) return reply(response, Number(path.split("/").at(-1)), Buffer.alloc(0), "/echo");
          if (path === "/relative/start") return reply(response, 302, Buffer.alloc(0), "../echo");
          if (path === "/cycle") return reply(response, 302, Buffer.alloc(0), "/cycle");
          if (path === "/cross-port") return reply(response, 302, Buffer.alloc(0), `${origins.B}/echo`);
          if (path === "/cross-host") return reply(response, 302, Buffer.alloc(0), `${origins.H}/echo`);
          if (path === "/retry" && traces.length === 1) return reply(response, 503, Buffer.from("retry-body\n"));
          if (path.startsWith("/status/")) return reply(response, Number(path.split("/").at(-1)), Buffer.from("error-body\n"));
          if (path === "/bytes") return reply(response, 200, binary);
          reply(response, 200, Buffer.from("ok\n"));
        })().catch(() => response.destroy());
      });
      servers.push(server);
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        socket.on("error", () => {});
      });
      server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      assert(address && typeof address !== "string");
      origins[origin] = `http://127.0.0.1:${address.port}`;
    }
    origins.H = origins.A.replace("127.0.0.1", "localhost");
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    throw error;
  }
  const normalize = (value: string, root?: string): string => {
    for (const [label, url] of Object.entries(origins)) {
      value = value.replaceAll(url, `{${label}}`).replaceAll(new URL(url).host, `{${label}_HOST}`);
    }
    return root ? value.replaceAll(root, "{ROOT}") : value;
  };
  return {
    origins, traces, normalize,
    expand(value, root) {
      for (const [label, url] of Object.entries(origins)) value = value.replaceAll(`{${label}}`, url);
      return value.replaceAll("{ROOT}", root);
    },
    allow(url) {
      try {
        const parsed = new URL(url);
        return !parsed.username && !parsed.password && Object.values(origins).includes(parsed.origin);
      } catch { return false; }
    },
    waitForRequest: () => requested,
    async waitForIdle() {
      const deadline = Date.now() + 500;
      while (sockets.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(sockets.size, 0, "HTTP sockets still active after command settlement");
    },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await closeResources(servers, sockets);
    },
  };
}

export function semanticTrace(trace: Trace, lab: Pick<Lab, "normalize">): Trace {
  return {
    ...trace,
    headers: trace.headers
      .filter(([name]) => !["host", "user-agent", "connection", "content-length", "transfer-encoding", "expect"].includes(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), lab.normalize(value)]),
  };
}
