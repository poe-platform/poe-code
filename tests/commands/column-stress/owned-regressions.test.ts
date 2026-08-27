import assert from "node:assert/strict";
import test from "node:test";
import { createColumnCommand } from "../../../src/commands/column/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolveValue, rejectValue) => { resolve = resolveValue; reject = rejectValue; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function context(output: Uint8Array[]): CommandContext {
  return {
    command: "column", args: ["-t"], cwd: "/", env: { KEPT: "caller" },
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource("a b\n"),
    stdout: { async write(bytes) { output.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { assert.fail(Buffer.from(bytes).toString()); } },
  };
}

test("column accepts frozen nonenumerable CommandContext properties", async () => {
  const output: Uint8Array[] = [];
  const original = context(output);
  const supplied = Object.create(null) as CommandContext;
  for (const key of Reflect.ownKeys(original)) Object.defineProperty(supplied, key, { value: Reflect.get(original, key), enumerable: false, configurable: false, writable: false });
  Object.freeze(supplied);
  assert.equal((await createColumnCommand().execute(supplied)).exitCode, 0);
  assert.equal(Buffer.concat(output).toString(), "a  b\n");
  assert.equal(supplied.env, original.env);
  assert.equal(supplied.args, original.args);
});

test("column preserves inherited accessor receivers and caller-owned maps", async () => {
  const output: Uint8Array[] = [];
  const original = context(output);
  let registered = 0;
  class Host {
    #original = original;
    get command() { return this.#original.command; }
    get args() { return this.#original.args; }
    get cwd() { return this.#original.cwd; }
    get env() { return this.#original.env; }
    get fs() { return this.#original.fs; }
    get signal() { return this.#original.signal; }
    get stdin() { return this.#original.stdin; }
    get stdout() { return this.#original.stdout; }
    get stderr() { return this.#original.stderr; }
    registerCleanup() { assert.equal(this.#original, original); registered++; }
  }
  const supplied = Object.freeze(new Host());
  assert.equal((await createColumnCommand().execute(supplied)).exitCode, 0);
  assert.equal(Buffer.concat(output).toString(), "a  b\n");
  assert.equal(registered, 1);
  assert.equal(supplied.env, original.env);
});

for (const rejectCleanup of [false, true]) for (const withHook of [false, true]) {
  test(`column late caller abort wins deferred cleanup reject=${rejectCleanup} hook=${withHook}`, async () => {
    const entered = deferred(), release = deferred();
    const controller = new AbortController();
    const reason = { code: "ENOENT", marker: "caller-after-budget-error" };
    let returns = 0;
    const supplied: CommandContext = {
      ...context([]), signal: controller.signal,
      stdin: { [Symbol.asyncIterator]() { return {
        async next() { return { done: false, value: Buffer.from("a b\n") }; },
        async return() { returns++; entered.resolve(); await release.promise; return { done: true, value: undefined }; },
      }; } },
      stderr: { async write() {} },
      ...(withHook ? { registerCleanup() {} } : {}),
    };
    const operation = Promise.resolve(createColumnCommand({ limits: { maxInputBytes: 1 } }).execute(supplied));
    void operation.catch(() => {});
    try {
      await entered.promise;
      controller.abort(reason);
      if (rejectCleanup) release.reject(new Error("cooperative cleanup error")); else release.resolve();
      await assert.rejects(operation, (error: unknown) => error === reason);
      assert.equal(returns, 1);
    } finally { release.resolve(); await operation.catch(() => {}); }
  });
}
