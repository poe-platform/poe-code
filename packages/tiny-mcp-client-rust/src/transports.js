import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
const { NativeStderr } = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");

export function createInMemoryTransportPair() {
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  const dispose = (reason = new Error("In-memory transport disposed")) => {
    if (finish === undefined) return;
    const resolve = finish;
    finish = undefined;
    for (const stream of [upstream, downstream]) {
      if (!stream.destroyed && !stream.writableEnded) stream.end();
    }
    resolve({ reason });
  };
  for (const stream of [upstream, downstream]) stream.once("error", error => {
    dispose(error instanceof Error ? error : new Error(String(error)));
  });
  return {
    clientTransport: { readable: downstream, writable: upstream, closed, dispose },
    serverTransport: { readable: upstream, writable: downstream }
  };
}

export class StdioTransport {
  #child;
  #stderr = new NativeStderr();
  #disposed = false;
  constructor({ command, args = [], cwd, env, spawn: start = spawn }) {
    const child = start(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.#child = child;
    this.readable = child.stdout;
    this.writable = child.stdin;
    const decoder = new TextDecoder();
    child.stderr.on("data", chunk => {
      const decoded = chunk instanceof Uint8Array ? decoder.decode(chunk, { stream: true }) : decoder.decode() + String(chunk);
      this.#stderr.append(decoded);
    });
    child.stderr.once("end", () => { this.#stderr.append(decoder.decode()); });
    this.closed = new Promise(resolve => {
      let settled = false;
      let streamError;
      const finish = event => {
        if (settled) return;
        settled = true;
        resolve(event);
      };
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.once("error", error => {
        streamError ??= error;
        this.dispose(error);
      });
      child.once("exit", (code, signal) => {
        finish({ reason: streamError ?? new Error("Stdio transport process exited"), ...(code === null ? {} : { code }), ...(signal === null ? {} : { signal }) });
      });
      child.once("error", error => {
        finish({ reason: error instanceof Error ? error : new Error(String(error)), ...(child.exitCode === null ? {} : { code: child.exitCode }), ...(child.signalCode === null ? {} : { signal: child.signalCode }) });
      });
    });
  }
  getStderrOutput() { return this.#stderr.snapshot(); }
  dispose(_reason = new Error("Stdio transport disposed")) {
    if (this.#disposed) return;
    this.#disposed = true;
    const child = this.#child;
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
    if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill("SIGTERM");
  }
}
