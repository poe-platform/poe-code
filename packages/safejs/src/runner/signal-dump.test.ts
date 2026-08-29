import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { createSandboxClosure, createSandboxPromise } = await import("../interp/values.js");
const { hashSource } = await import("../parse/hash.js");
const { run } = await import("../run.js");
const { restore } = await import("../restore.js");
const { declareHostOperation } = await import("../interp/host-bridge.js");
const { attachSignalDumpHandler } = await import("./signal-dump.js");

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("runner signal dump handling", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers a signal-requested checkpoint while an injected host call is pending", async () => {
    const source = "return await checkpoint()";
    const gate = createDeferred<number>();
    const paused = createDeferred<void>();
    const signalProcess = createProcessDouble();
    const captured = vi.fn();
    const onError = vi.fn();
    const execution = run(source, {
      bindings: {
        checkpoint: declareHostOperation(async () => {
          paused.resolve();
          return gate.promise;
        }, "re-issue")
      }
    });
    const cleanup = attachSignalDumpHandler(execution, {
      process: signalProcess,
      onSnapshot: captured,
      onError,
      stderr: createStreamDouble()
    });

    try {
      await paused.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      signalProcess.emit("SIGUSR1");
      await flushMicrotasks();

      expect(onError).not.toHaveBeenCalled();
      expect(captured).toHaveBeenCalledTimes(1);
      const snapshot = restore(JSON.parse(captured.mock.calls[0]![0]), { source });
      expect(snapshot.hostCalls).toEqual([
        expect.objectContaining({ lifecycle: "running", operation: "checkpoint" })
      ]);
      await expect(
        run(source, {
          snapshot,
          bindings: { checkpoint: declareHostOperation(async () => 13, "re-issue") }
        })
      ).resolves.toMatchObject({ ok: true, returnValue: 13 });
    } finally {
      cleanup();
      gate.resolve(13);
      await execution;
    }
  });

  it("writes a dump file at the configured path on SIGUSR1 mid-run", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const result = run("const current = 'paused'; await wait(); return current;", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    expect(vol.existsSync("/dumps/run.json")).toBe(true);

    wait.resolve("done");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "paused"
    });
  });

  it("writes a dump for each consecutive signal without debouncing", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const writeFile = vi.fn(async (filePath: string, content: string) => {
      const { fs } = await import("memfs");
      await fs.promises.writeFile(filePath, content, "utf8");
    });
    const result = run("await wait(); return 'done';", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process,
      writeFile
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    process.emit("SIGUSR1");
    await flushMicrotasks();

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^\/dumps\/\.run\.json\..+\.tmp$/),
      expect.stringContaining('"sourceHash"'),
      { encoding: "utf8", flag: "wx" }
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^\/dumps\/\.run\.json\..+\.tmp$/),
      expect.stringContaining('"sourceHash"'),
      { encoding: "utf8", flag: "wx" }
    );

    wait.resolve("done");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });

  it("does not follow or remove a colliding dump temp symlink", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const stderr = createStreamDouble();
    const result = run("await wait(); return 'done';", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });
    vol.fromJSON({ "/outside/dump.tmp": "outside-state\n" });
    let tempPath: string | undefined;

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process,
      stderr,
      writeFile: vi.fn(async (filePath, content, options) => {
        tempPath = filePath;
        vol.symlinkSync("/outside/dump.tmp", filePath);
        const { fs } = await import("memfs");
        await fs.promises.writeFile(filePath, content, options);
      })
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    expect(tempPath).toBeDefined();
    expect(vol.readFileSync("/outside/dump.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(tempPath as string).isSymbolicLink()).toBe(true);
    await vi.waitFor(() => {
      expect(stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write SIGUSR1 dump")
      );
    });

    wait.resolve("done");
    await result;
  });

  it("removes a partial dump temp file when writing fails", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const stderr = createStreamDouble();
    const result = run("await wait(); return 'done';", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });
    let tempPath: string | undefined;

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process,
      stderr,
      writeFile: vi.fn(async (filePath, content, options) => {
        tempPath = filePath;
        const { fs } = await import("memfs");
        await fs.promises.writeFile(filePath, content.slice(0, 12), options);
        throw new Error("dump disk full");
      })
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    await vi.waitFor(() => {
      expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("dump disk full"));
    });
    expect(tempPath).toBeDefined();
    expect(vol.existsSync(tempPath ?? "")).toBe(false);
    expect(vol.existsSync("/dumps/run.json")).toBe(false);

    wait.resolve("done");
    await result;
  });

  it("removes partial dump temp files when write errors only inherit existing-path codes", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const stderr = createStreamDouble();
    const result = run("await wait(); return 'done';", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });
    let tempPath: string | undefined;

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process,
      stderr,
      writeFile: vi.fn(async (filePath, content, options) => {
        tempPath = filePath;
        const { fs } = await import("memfs");
        await fs.promises.writeFile(filePath, content.slice(0, 12), options);
        throw new Error("dump disk full");
      })
    });

    await flushMicrotasks();
    await withObjectPrototypeCode("EEXIST", async () => {
      process.emit("SIGUSR1");
      await flushMicrotasks();

      await vi.waitFor(() => {
        expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("dump disk full"));
      });
    });

    expect(tempPath).toBeDefined();
    expect(vol.existsSync(tempPath ?? "")).toBe(false);
    expect(vol.existsSync("/dumps/run.json")).toBe(false);

    wait.resolve("done");
    await result;
  });

  it("dumps while the runner is paused on an await with current scope and pending awaits", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const result = run("const current = 'paused'; await wait(); return current;", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    const snapshot = JSON.parse(vol.readFileSync("/dumps/run.json", "utf8") as string) as {
      bindings?: Record<string, unknown>;
      pendingAwaits?: Array<{ nodeId?: number; span: unknown }>;
    };

    expect(snapshot.bindings).toMatchObject({
      current: "paused"
    });
    expect(snapshot.pendingAwaits).toEqual([
      {
        nodeId: expect.any(Number),
        span: expect.objectContaining({
          start: expect.objectContaining({
            line: 1
          })
        })
      }
    ]);

    wait.resolve("done");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "paused"
    });
  });

  it("logs write errors to stderr and lets the runner continue", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const stderr = createStreamDouble();
    const result = run("await wait(); return 'done';", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process,
      stderr,
      writeFile: vi.fn(async () => {
        throw new Error("EACCES");
      })
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("Failed to write SIGUSR1 dump to /dumps/run.json: EACCES")
    );

    wait.resolve("done");
    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });

  it("preserves a prior dump when replacing it fails", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const stderr = createStreamDouble();
    const result = run("await wait(); return 'done';", {
      bindings: { wait: createWaitBinding(wait) }
    });
    vol.fromJSON({ "/dumps/run.json": '{"previous":"recoverable"}\n' });

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process,
      stderr,
      writeFile: vi.fn(async (filePath, content) => {
        await import("memfs").then(({ fs }) => fs.promises.writeFile(filePath, content, "utf8"));
        throw new Error("dump write interrupted");
      })
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    expect(vol.readFileSync("/dumps/run.json", "utf8")).toBe('{"previous":"recoverable"}\n');
    await vi.waitFor(() => {
      expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("dump write interrupted"));
    });

    wait.resolve("done");
    await result;
  });

  it("writes parseable JSON", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const result = run("await wait(); return 'done';", {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    expect(() => JSON.parse(vol.readFileSync("/dumps/run.json", "utf8") as string)).not.toThrow();

    wait.resolve("done");
    await result;
  });

  it("includes sourceHash so the dump can be diffed against the source later", async () => {
    const wait = createDeferred<string>();
    const process = createProcessDouble();
    const source = "await wait(); return 'done';";
    const result = run(source, {
      bindings: {
        wait: createWaitBinding(wait)
      }
    });

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    const snapshot = JSON.parse(vol.readFileSync("/dumps/run.json", "utf8") as string) as {
      sourceHash?: string;
    };

    expect(snapshot.sourceHash).toBe(hashSource(source));

    wait.resolve("done");
    await result;
  });

  it("removes the signal handler when the runner finishes so later signals fall through", async () => {
    const process = createProcessDouble();
    const result = run("return 'done';");

    attachSignalDumpHandler(result, {
      dumpPath: "/dumps/run.json",
      process
    });

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
    await flushMicrotasks();

    expect(process.listenerCount("SIGUSR1")).toBe(0);
    expect(process.emit("SIGUSR1")).toBe(false);
    expect(vol.existsSync("/dumps/run.json")).toBe(false);
  });

  it("lets multiple runners in one process dump independently", async () => {
    const firstWait = createDeferred<string>();
    const secondWait = createDeferred<string>();
    const process = createProcessDouble();
    const first = run("const marker = 'first'; await wait(); return marker;", {
      bindings: {
        wait: createWaitBinding(firstWait)
      }
    });
    const second = run("const marker = 'second'; await wait(); return marker;", {
      bindings: {
        wait: createWaitBinding(secondWait)
      }
    });

    attachSignalDumpHandler(first, {
      dumpPath: "/dumps/first.json",
      process
    });
    attachSignalDumpHandler(second, {
      dumpPath: "/dumps/second.json",
      process
    });

    await flushMicrotasks();
    process.emit("SIGUSR1");
    await flushMicrotasks();

    expect(JSON.parse(vol.readFileSync("/dumps/first.json", "utf8") as string)).toMatchObject({
      bindings: {
        marker: "first"
      }
    });
    expect(JSON.parse(vol.readFileSync("/dumps/second.json", "utf8") as string)).toMatchObject({
      bindings: {
        marker: "second"
      }
    });

    firstWait.resolve("done");
    secondWait.resolve("done");
    await Promise.all([first, second]);
  });
});

function createProcessDouble() {
  return new EventEmitter();
}

function createStreamDouble() {
  return {
    write: vi.fn()
  };
}

function createWaitBinding(deferred: ReturnType<typeof createDeferred<string>>) {
  return createSandboxClosure({
    async: true,
    call: () => createSandboxPromise(deferred.promise),
    name: "wait"
  });
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
}

async function flushMicrotasks(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
