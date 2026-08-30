import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { toByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createCurlCommand, type HttpResponse, type NetworkCommandsOptions } from "../../../src/commands/network/index.js";

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accepted, rejected) => { resolve = accepted; reject = rejected; });
  return { promise, resolve, reject };
}

export async function bounded<Value>(promise: PromiseLike<Value>, label: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Barrier timed out: ${label}`)), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function drain(): Promise<void> {
  await setImmediate();
  await setImmediate();
}

export function response(headers: HttpResponse["headers"] = [], status = 200): HttpResponse {
  return { status, statusText: status === 200 ? "OK" : "Found", headers, body: toByteSource(""), async dispose() {} };
}

export function start(args: readonly string[], options: NetworkCommandsOptions, controller = new AbortController()) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "curl", args: ["--max-time", "1.5", ...args], cwd: "/", env: {}, signal: controller.signal,
    fs: new Proxy({} as FileSystem, { get(_target, property) { assert.fail(`Unexpected VFS access: ${String(property)}`); } }),
    stdin: toByteSource(""),
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  };
  const command = createCurlCommand(options);
  const done = Promise.resolve(command.execute(context)).then(result => ({
    ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(),
  }));
  void done.catch(() => {});
  return { done, controller };
}
