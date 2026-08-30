import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { setImmediate as tick } from "node:timers/promises";
import { after, beforeEach, test } from "node:test";
import type { Worker } from "node:worker_threads";
import { RegexExecutor } from "../../../../src/commands/regex-execution/client.js";
import { inputBytes, type GlobDescriptor, type Request } from "../../../../src/commands/regex-execution/protocol.js";
import { agentCommands, MemoryFileSystem, Shell, type FileSystem } from "../../../../src/index.js";

const workerModule = createRequire(import.meta.url)("node:worker_threads") as { Worker: typeof Worker };
const NativeWorker = workerModule.Worker;
let workers: ControlledWorker[] = [];
let acquisitionError = false;
let requestFailure: "messageerror" | "match" | undefined;
class ControlledWorker extends EventEmitter {
  readonly requests: Request[] = [];
  terminated = 0;
  constructor() {
    super();
    if (acquisitionError) throw new Error("controlled acquisition failure");
    workers.push(this);
    queueMicrotask(() => this.emit("message", { ready: true }));
  }
  ref(): this { return this; }
  unref(): this { return this; }
  postMessage(request: Request): void {
    this.requests.push(request);
    if (requestFailure === "messageerror") this.emit("messageerror", new Error("controlled glob reply failure"));
    if (requestFailure === "match") this.emit("message", { id: request.id, error: "invalid glob: controlled malformed ignore rule" });
  }
  reply(): void {
    const request = this.requests.at(-1)!;
    this.emit("message", { id: request.id, results: request.rows.map(() => new Float64Array([0, 0])) });
  }
  async terminate(): Promise<number> { this.terminated++; this.emit("exit", 1); return 1; }
}
workerModule.Worker = ControlledWorker as unknown as typeof Worker;
syncBuiltinESMExports();
beforeEach(() => { workers = []; acquisitionError = false; requestFailure = undefined; });
after(() => { workerModule.Worker = NativeWorker; syncBuiltinESMExports(); });
const descriptor = (): GlobDescriptor => ({ kind: "glob", patterns: ["alpha.*"], globOptions: [{ insensitive: false, literalUnclosedClass: false }] });
const rows = () => [{ bytes: Buffer.from("alpha.ts", "utf16le"), all: false, terminated: true, directory: false, ancestors: false }];
function clean(): void {
  for (const worker of workers) {
    assert.equal(worker.terminated, 1);
    for (const event of ["message", "messageerror", "error", "exit"]) assert.equal(worker.listenerCount(event), 0);
  }
}

test("glob queued admission accounts options, copies flags/bytes and cancels exact waiter", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const waiterController = new AbortController();
  const pendingDescriptor = descriptor();
  const pendingRows = rows();
  const bytes = inputBytes(pendingDescriptor, pendingRows, controller.signal);
  const executor = new RegexExecutor({ maxWorkers: 1, maxQueuedRequests: 2, maxQueuedBytes: bytes, requestTimeoutMs: 1000 });
  const session = executor.open(controller.signal);
  const waiter = executor.open(waiterController.signal);
  assert.equal(workers.length, 0);
  const active = session.run(descriptor(), rows());
  const queued = session.run(pendingDescriptor, pendingRows);
  try {
    await assert.rejects(waiter.run(descriptor(), rows()), { code: "QUEUE_EXHAUSTED" });
    (pendingDescriptor.globOptions[0] as { insensitive: boolean }).insensitive = true;
    (pendingDescriptor.patterns as string[])[0] = "changed";
    pendingRows[0]!.bytes.fill(0);
    await tick();
    workers[0]!.reply();
    await active;
    await tick();
    const copy = workers[0]!.requests[1]!;
    assert.deepEqual(copy.descriptor, descriptor());
    assert.deepEqual(Buffer.from(copy.rows[0]!.bytes), Buffer.from("alpha.ts", "utf16le"));
    const cancelled = waiter.run(descriptor(), rows()).then(() => undefined, (error: unknown) => error);
    const reason = new Error("cancel exact glob waiter");
    waiterController.abort(reason);
    assert.equal(await cancelled, reason);
    const state = executor as unknown as { queuedBytes: number; queue: unknown[] };
    assert.equal(state.queuedBytes, 0);
    assert.equal(state.queue.length, 0);
    assert.equal(getEventListeners(waiterController.signal, "abort").length, 0);
    workers[0]!.reply();
    await queued;
  } finally { await executor.dispose(); await Promise.allSettled([active, queued]); await session.close(); await waiter.close(); }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  clean();
});

test("glob active abort retires its lease while another request remains usable", { timeout: 2000 }, async () => {
  const executor = new RegexExecutor();
  const controller = new AbortController();
  const otherController = new AbortController();
  const session = executor.open(controller.signal);
  const other = executor.open(otherController.signal);
  const cancelled = session.run(descriptor(), rows()).then(() => undefined, (error: unknown) => error);
  const success = other.run(descriptor(), rows());
  try {
    await tick();
    assert.equal(workers.length, 2);
    const reason = new Error("cancel active benign glob");
    controller.abort(reason);
    assert.equal(await cancelled, reason);
    assert.equal(workers[0]!.terminated, 1);
    assert.equal(workers[1]!.terminated, 0);
    workers[1]!.reply();
    assert.deepEqual(await success, [[{ start: 0, end: 0 }]]);
  } finally { await executor.dispose(); await Promise.allSettled([cancelled, success]); await session.close(); await other.close(); }
  for (const signal of [controller.signal, otherController.signal]) assert.equal(getEventListeners(signal, "abort").length, 0);
  clean();
});

test("glob acquisition error releases pending listener and invocation closes once", { timeout: 2000 }, async () => {
  acquisitionError = true;
  const executor = new RegexExecutor();
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  try { await assert.rejects(session.run(descriptor(), []), /controlled acquisition failure/u); }
  finally { await session.close(); await session.close(); await executor.dispose(); }
  assert.equal((executor as unknown as { sessions: number }).sessions, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(workers.length, 0);
});

for (const failure of ["messageerror", "match"] as const) test(`public ignore ${failure} preserves fatal-resource versus malformed-rule behavior`, { timeout: 2000 }, async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work");
  await backing.writeFile("/work/.ignore", Buffer.from("alpha.*\n"));
  await backing.writeFile("/work/alpha.ts", Buffer.from("hit\n"));
  let listings = 0;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "readdir") return (...args: Parameters<FileSystem["readdir"]>) => { listings++; return target.readdir(...args); };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  requestFailure = failure;
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("rg --files");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, failure === "match" ? "alpha.ts\n" : "");
    assert.match(result.stderr, failure === "match" ? /invalid glob/u : /regex PROTOCOL/u);
    assert.equal(listings, failure === "match" ? 1 : 0);
    clean();
  } finally { await shell.dispose(); }
});

test("errno-shaped abort during ignore loading preserves identity and stops VFS traversal", { timeout: 2000 }, async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work");
  const controller = new AbortController();
  const reason = Object.assign(new Error("abort is not a missing ignore file"), { code: "ENOENT" });
  let afterAbortCalls = 0;
  const fs = new Proxy(backing, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (controller.signal.aborted) afterAbortCalls++;
        if (property === "readFile" && String(args[0]).endsWith("/.ignore")) { controller.abort(reason); throw reason; }
        return value.apply(target, args);
      };
    },
  });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    await assert.rejects(shell.exec("rg --files", { signal: controller.signal }), error => error === reason);
    await tick();
    assert.equal(afterAbortCalls, 0);
    assert.equal(workers.length, 0);
  } finally { await shell.dispose(); }
});
