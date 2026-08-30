import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { payload } from "./supplement-rows.js";

export const certificatePath = "tests/commands/network/tls/cert.pem";
export const keyPath = "tests/commands/network/tls/key.pem";
export interface SupplementTrace {
  origin: string;
  method: string;
  path: string;
  headers: [string, string][];
  body: string;
}

export async function supplementaryLab() {
  const servers: Server[] = [];
  const sockets = new Set<Socket>();
  const tasks = new Set<Promise<void>>();
  const origins: Record<string, string> = {};
  const traces: SupplementTrace[] = [];
  const uploads: Buffer[] = [];
  let notifyUpload!: () => void;
  const acceptedUpload = new Promise<void>((resolve) => { notifyUpload = resolve; });
  const certificate = await readFile(certificatePath);
  const key = await readFile(keyPath);
  const reply = (response: ServerResponse, code: number, body: Buffer, location?: string) => {
    response.sendDate = false;
    response.writeHead(code, { "Content-Length": body.length, "Content-Type": "application/octet-stream", Connection: "close", ...(location ? { Location: location } : {}) });
    response.end(body);
  };
  async function handle(origin: string, request: IncomingMessage, response: ServerResponse) {
    const trace: SupplementTrace = { origin, method: request.method ?? "", path: request.url ?? "", headers: [], body: "" };
    for (let index = 0; index < request.rawHeaders.length; index += 2) trace.headers.push([request.rawHeaders[index]!, request.rawHeaders[index + 1]!]);
    traces.push(trace);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      assert(size <= 1024 * 1024);
      chunks.push(bytes);
      trace.body = Buffer.concat(chunks).toString("base64");
      if (trace.path === "/uploadstall") { uploads.push(bytes); notifyUpload(); }
    }
    if (trace.path === "/uploadstall") return;
    if (trace.path === "/stall") {
      response.sendDate = false;
      response.writeHead(200, { "Content-Length": 99999, Connection: "close" });
      response.write(payload);
      return;
    }
    if (trace.path === "/redirect307") return reply(response, 307, Buffer.alloc(0), "/echo");
    if (trace.path === "/cross") return reply(response, 302, Buffer.alloc(0), `${origins.B}/echo`);
    if (trace.path === "/cross-return") return reply(response, 302, Buffer.alloc(0), `${origins.B}/return`);
    if (trace.path === "/return") return reply(response, 302, Buffer.alloc(0), `${origins.A}/echo`);
    if (trace.path === "/downgrade") return reply(response, 302, Buffer.alloc(0), `${origins.A}/echo`);
    reply(response, 200, trace.path === "/bytes" ? payload : Buffer.from("ok\n"));
  }
  async function close() {
    const closed = [...sockets].map((socket) => new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.destroy(); }));
    await Promise.all([...closed, ...servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))]);
    await Promise.all(tasks);
    assert.equal(sockets.size, 0);
  }
  try {
    for (const origin of ["A", "B", "T"]) {
      const listener = (request: IncomingMessage, response: ServerResponse) => {
        const task = handle(origin, request, response).catch(() => { response.destroy(); });
        tasks.add(task);
        void task.then(() => tasks.delete(task));
      };
      const server = origin === "T" ? createHttpsServer({ cert: certificate, key }, listener) : createServer(listener);
      servers.push(server);
      server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {}); });
      server.on("tlsClientError", () => {});
      server.on("clientError", (_error, socket) => socket.destroy());
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
      const address = server.address();
      assert(address && typeof address !== "string");
      origins[origin] = `${origin === "T" ? "https" : "http"}://127.0.0.1:${address.port}`;
    }
  } catch (error) { await close(); throw error; }
  const normalize = (value: string) => {
    for (const [name, origin] of Object.entries(origins)) value = value.replaceAll(origin, `{${name}}`);
    return value;
  };
  return { origins, traces, uploads, acceptedUpload, certificate, close, normalize,
    allow: (url: string) => Object.values(origins).includes(new URL(url).origin),
    expand(value: string) { for (const [name, origin] of Object.entries(origins)) value = value.replaceAll(`{${name}}`, origin); return value; },
    async idle() { for (let attempt = 0; attempt < 50 && sockets.size; attempt++) await delay(10); assert.equal(sockets.size, 0, "Peer sockets remain open after settlement"); },
  };
}

export function canonicalTrace(trace: SupplementTrace): SupplementTrace {
  let body = Buffer.from(trace.body, "base64");
  const contentType = trace.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
  const boundary = contentType?.match(/^multipart\/form-data; boundary=(.+)$/)?.[1];
  if (boundary) {
    assert(body.includes(Buffer.from(`--${boundary}--\r\n`)), "Multipart closing delimiter missing");
    body = Buffer.from(body.toString("latin1").replaceAll(boundary, "FROZEN_BOUNDARY"), "latin1");
  }
  const headers: [string, string][] = trace.headers
    .filter(([name]) => !["host", "user-agent", "connection", "content-length", "transfer-encoding", "expect"].includes(name.toLowerCase()))
    .map(([name, value]) => [name.toLowerCase(), boundary ? value.replaceAll(boundary, "FROZEN_BOUNDARY") : value]);
  headers.sort(([first], [second]) => first.localeCompare(second));
  return { ...trace, headers, body: body.toString("base64") };
}
