import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createAgentCommands, createMemoryFileSystem } from "../../src/index.js";
import { workerCommands, collisionCommands, omittedOptionsCommands, cancelledOpenCommands } from "./timeout-worker-fixture.js";
import { captureContext } from "./timeout-author-20260828/fixtures.js";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";

test("hosts without an escalation boundary refuse kill-after before invoking the child", async () => {
  let invoked = false;
  const capture = captureContext(["-k0.02", "1", "child"], { invoke: async () => { invoked = true; return { exitCode: 0 }; } });
  assert.equal((await createTimeoutCommand().execute(capture.context)).exitCode, 125);
  assert.equal(invoked, false);
  assert.equal(capture.stderr(), "timeout: hard escalation is unavailable on this host\n");
});

test("cancelled worker stream-open replies close their admitted reader before continuing", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("retained"));
  const shell = new Shell({ fs, deviceView: "provided", workerModules: [{
    specifier: new URL("./timeout-worker-fixture.ts", import.meta.url).href,
    exportName: "cancelledOpenCommands",
  }] }).use(agentCommands()).use(cancelledOpenCommands());
  try {
    const result = await shell.exec("timeout -k0.02 2 cancelled-open-child");
    assert.equal(result.exitCode, 9);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { closes: 1 });
    assert.equal((await shell.exec("printf reusable")).stdout, "reusable");
  } finally { await shell.dispose(); }
});

test("agent composition retains an explicitly supplied kill-after policy", async () => {
  const timeout = createAgentCommands({ timeout: { killAfterPolicy: async () => ({ exitCode: 137 }) } }).find(command => command.name === "timeout")!;
  const capture = captureContext(["-k0.02", "1", "child"], { invoke: async () => assert.fail("explicit policy was discarded") });
  assert.equal((await timeout.execute(capture.context)).exitCode, 137);
});

test("default kill-after terminates a shell which ignores TERM", { timeout: 5000 }, async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout -k0.02 0.2 sh -c 'trap \"\" TERM; while :; do :; done'");
    assert.equal(result.exitCode, 137);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("explicit worker commands can be forcibly retired while their event loop is blocked", { timeout: 5000 }, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), workerModules: [{
    specifier: new URL("./timeout-worker-fixture.ts", import.meta.url).href,
    exportName: "workerCommands",
  }] });
  shell.use(agentCommands()).use(workerCommands());
  try {
    const result = await shell.exec("timeout -k0.02 0.2 sh -c 'trap \"\" TERM; busy-child'");
    assert.equal(result.exitCode, 137);
    assert.equal(result.stdout, "started");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("default TERM can retire a blocked event loop without waiting for escalation", { timeout: 5000 }, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), workerModules: [{
    specifier: new URL("./timeout-worker-fixture.ts", import.meta.url).href,
    exportName: "workerCommands",
  }] });
  shell.use(agentCommands()).use(workerCommands());
  try {
    const result = await shell.exec("timeout --preserve-status -k1 0.1 busy-child");
    assert.equal(result.exitCode, 143);
    assert.equal(result.stdout, "started");
  } finally { await shell.dispose(); }
});

test("default signal disposition and preserve-status agree after worker retirement", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout --preserve-status -k0.02 0.02 sleep 1");
    assert.equal(result.exitCode, 143);
    assert.equal(result.stderr, "");
    const bytes = await shell.exec('v=$(printf "\\377"); timeout -k0.02 2 printf %s "$v"');
    assert.equal(bytes.exitCode, 0);
    assert.deepEqual(bytes.stdoutBytes, Uint8Array.of(255));
  } finally { await shell.dispose(); }
});

test("worker timeout preserves child status without expiry", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout -k0.03 2 sh -c 'printf done; exit 9'");
    assert.equal(result.exitCode, 9);
    assert.equal(result.stdout, "done");
  } finally { await shell.dispose(); }
});

test("worker children inherit the caller's creation mask", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("umask 000; timeout -k0.02 2 sh -c 'printf data > /created'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/created")).mode & 0o777, 0o666);
  } finally { await shell.dispose(); }
});

test("worker children inherit ignored TERM from their caller", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("trap '' TERM; timeout -k0.02 0.2 sh -c 'while :; do :; done'");
    assert.equal(result.exitCode, 137);
  } finally { await shell.dispose(); }
});

test("parent cancellation retires the worker and preserves the parent's reason", { timeout: 5000 }, async () => {
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    await assert.rejects(shell.exec("timeout -k0.02 2 sh -c 'printf ready; while :; do :; done'", {
      signal: controller.signal,
      stdout: { async write() { controller.abort(reason); } },
    }), error => error === reason);
  } finally { await shell.dispose(); }
});

test("worker timeout retires a pending stdin read and leaves closure to its caller", { timeout: 5000 }, async () => {
  let started = false;
  let closes = 0;
  const stdin = {
    [Symbol.asyncIterator]() {
      return {
        next() { started = true; return new Promise<IteratorResult<Uint8Array>>(() => {}); },
        async return() { closes++; return { done: true as const, value: undefined }; },
      };
    },
  };
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout -k0.02 0.2 cat", { stdin });
    assert.equal(result.exitCode, 124);
    assert.equal(started, true);
    assert.equal(closes, 1);
  } finally { await shell.dispose(); }
});

test("STOP waits for hard escalation rather than terminating the child", { timeout: 5000 }, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(agentCommands());
  try {
    const result = await shell.exec("timeout --preserve-status -s STOP -k0.02 0.02 sleep 1");
    assert.equal(result.exitCode, 137);
  } finally { await shell.dispose(); }
});

test("worker dispatch preserves custom commands colliding with internal entry names", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), workerModules: [{
    specifier: new URL("./timeout-worker-fixture.ts", import.meta.url).href,
    exportName: "collisionCommands",
  }] }).use(agentCommands()).use(collisionCommands());
  try {
    for (const command of ["__timeout_worker_entry", "__timeout_worker_entry-"]) {
      const result = await shell.exec(`timeout -k0.02 2 ${command}`);
      assert.equal(result.exitCode, 9);
      assert.equal(result.stdout, command);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("worker filesystem calls retain their signal when options are explicitly undefined", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("retained"));
  const read = fs.readFile.bind(fs);
  let observedSignal: AbortSignal | undefined;
  fs.readFile = async (path, options) => {
    if (path === "/file") observedSignal = options?.signal;
    return read(path, options);
  };
  const shell = new Shell({ fs, deviceView: "provided", workerModules: [{
    specifier: new URL("./timeout-worker-fixture.ts", import.meta.url).href,
    exportName: "omittedOptionsCommands",
  }] }).use(agentCommands()).use(omittedOptionsCommands());
  try {
    const result = await shell.exec("timeout -k0.02 2 omitted-options-child");
    assert.equal(result.exitCode, 9);
    assert.equal(result.stdout, "retained");
    assert.equal(result.stderr, "");
    assert.ok(observedSignal instanceof AbortSignal);
    assert.equal(observedSignal.aborted, true);
  } finally { await shell.dispose(); }
});

test("worker filesystem calls preserve optional positional arguments before options", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("retained"));
  const access = fs.access.bind(fs);
  const truncate = fs.truncate!.bind(fs);
  const calls: { argument: unknown; signal: AbortSignal | undefined }[] = [];
  fs.access = async (path, mode, options) => {
    calls.push({ argument: mode, signal: options?.signal });
    return access(path, mode, options);
  };
  fs.truncate = async (path, length, options) => {
    calls.push({ argument: length, signal: options?.signal });
    return truncate(path, length, options);
  };
  const shell = new Shell({ fs, deviceView: "provided", workerModules: [{
    specifier: new URL("./timeout-worker-fixture.ts", import.meta.url).href,
    exportName: "omittedOptionsCommands",
  }] }).use(agentCommands()).use(omittedOptionsCommands());
  try {
    const result = await shell.exec("timeout -k0.02 2 optional-position-child");
    assert.equal(result.exitCode, 9);
    assert.equal(result.stderr, "");
    assert.deepEqual(calls.map(call => call.argument), [undefined, undefined, 4, undefined, undefined, 0]);
    for (const call of calls) {
      assert.ok(call.signal instanceof AbortSignal);
      assert.equal(call.signal.aborted, true);
    }
    assert.equal((await fs.readFile("/file")).length, 0);
  } finally { await shell.dispose(); }
});

for (const operation of ["metadata", "stream"] as const) {
  test(`ordinary nested timeout cancels worker ${operation} operations`, async () => {
    for (const isolated of [false, true]) {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/blocked", new Uint8Array());
      let started = false, closed = false;
      const wait = async (signal: AbortSignal | undefined) => {
        assert.ok(signal instanceof AbortSignal);
        signal.throwIfAborted();
        started = true;
        try {
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        } finally { closed = true; }
      };
      if (operation === "metadata") {
        for (const method of ["stat", "lstat"] as const) {
          const original = fs[method].bind(fs);
          fs[method] = async (path, options) => {
            if (path === "/blocked") await wait(options?.signal);
            return original(path, options);
          };
        }
      } else {
        const original = fs.readStream!.bind(fs);
        fs.readStream = (path, options) => path === "/blocked" ? {
          async *[Symbol.asyncIterator]() { await wait(options?.signal); yield new Uint8Array(); },
        } : original(path, options);
      }
      const shell = new Shell({ fs, deviceView: "provided" }).use(agentCommands());
      try {
        const child = operation === "metadata" ? "ls -d /blocked" : "cat /blocked";
        const script = `sh -c 'timeout 0.02 ${child}; printf continued; sleep 0.1'`;
        const observations: boolean[] = [];
        const result = await shell.exec(isolated ? `timeout --preserve-status -k0.1 1 ${script}` : script, {
          stdout: { async write(bytes) {
            if (new TextDecoder().decode(bytes) === "continued") observations.push(closed);
          } },
        });
        assert.equal(result.exitCode, 0);
        assert.deepEqual(observations, [true]);
        assert.equal(started, true);
        assert.equal(closed, true);
        assert.equal((await shell.exec("printf reusable")).stdout, "reusable");
      } finally { await shell.dispose(); }
    }
  });
}
