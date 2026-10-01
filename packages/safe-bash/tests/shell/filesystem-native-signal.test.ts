import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem, Shell, agentCommands } from "../../src/index.js";
import type { FileSystem } from "../../src/contracts/index.js";
import { workerRuntimeContexts } from "../../src/worker/runtime-context.js";

for (const memory of [false, true]) {
  for (const middleware of [false, true]) {
    for (const name of ["native-probe", "head"]) {
      test(`command signal is native before filesystem access: memory=${memory}, middleware=${middleware}, command=${name}`, async () => {
        const base = new MemoryFileSystem();
        const fs = memory ? base : nativeHostFileSystem(base, () => {});
        const shell = new Shell({ fs });
        if (middleware) shell.use((_context, next) => next());
        let checked = 0;
        shell.use({ name: "native-probe", setup({ commands }) {
          commands.register({ name, execute(context) {
            const signal = context.signal;
            AbortSignal.prototype.throwIfAborted.call(signal);
            new Request("https://example.invalid", { signal });
            AbortSignal.any([signal, new AbortController().signal]);
            assert.equal(context.signal, signal);
            assert.equal({ ...context }.signal, signal);
            checked++;
            return { exitCode: 0 };
          } });
        } });
        try {
          for (const script of [name, `${name} | ${name}`, `sh -c "${name}"`]) {
            const result = await shell.exec(script);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          assert.equal(checked, 4);
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const middleware of [false, true]) {
  for (const callerSignal of [false, true]) {
    test(`scoped filesystem resize signals are native: middleware=${middleware}, callerSignal=${callerSignal}`, async () => {
      const base = new MemoryFileSystem();
      await base.writeFile("/file", new Uint8Array([1, 2]));
      let observations = 0;
      const shell = new Shell({ fs: nativeHostFileSystem(base, () => { observations++; }) });
      if (middleware) shell.use((_context, next) => next());
      shell.use({ name: "resize-probe", setup({ commands }) {
        commands.register({ name: "resize-probe", async execute(context) {
          for (const fs of [context.fs, workerRuntimeContexts.get(context)!.fs]) {
            const handle = await fs.openResizeFile!("/file");
            try {
              await handle.truncate(1, callerSignal ? { signal: new AbortController().signal } : {});
            } finally { await handle.close(); }
          }
          return { exitCode: 0 };
        } });
      } });
      try {
        const result = await shell.exec("resize-probe");
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(await base.readFile("/file"), new Uint8Array([1]));
        assert.ok(observations > 0);
      } finally { await shell.dispose(); }
    });
  }
}

function nativeHostFileSystem(base: MemoryFileSystem, observe: (method: string, signal: AbortSignal) => void): FileSystem {
  // This is a host adapter, not the memory adapter's direct fast path.
  return new Proxy({} as FileSystem, {
    get(target, key) {
      if (key === "constructor") return target.constructor;
      const value = Reflect.get(base, key, base);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        for (const arg of args) {
          if (!arg || typeof arg !== "object" || !("signal" in arg) || !arg.signal) continue;
          const signal = arg.signal as AbortSignal;
          AbortSignal.prototype.throwIfAborted.call(signal);
          new Request("https://example.invalid", { signal });
          observe(String(key), signal);
        }
        return Reflect.apply(value, base, args);
      };
    },
  });
}

for (const [script, stdout] of [
  ["cd /d && pwd", "/d\n"],
  ["printf y > /d/out.txt && cat /d/out.txt", "y"],
  ["echo /d/*.txt", "/d/a.txt\n"],
  ["cd /d && pwd -P", "/d\n"],
] as const) {
  test(`runtime filesystem signals support native host APIs: ${script}`, async () => {
    const base = new MemoryFileSystem();
    await base.mkdir("/d");
    await base.writeFile("/d/a.txt", new TextEncoder().encode("a"));
    let observations = 0;
    const fs = nativeHostFileSystem(base, () => { observations++; });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
      assert.ok(observations > 0);
      if (script.startsWith("printf")) assert.equal(new TextDecoder().decode(await base.readFile("/d/out.txt")), "y");
    } finally { await shell.dispose(); }
  });
}

test("native filesystem signal delivers caller cancellation during cd", { timeout: 2000 }, async () => {
  const base = new MemoryFileSystem();
  await base.mkdir("/d");
  const controller = new AbortController();
  const reason = new Error("cancel host stat");
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let delivered: AbortSignal | undefined;
  let eventTarget: EventTarget | null | undefined;
  const fs = nativeHostFileSystem(base, (method, signal) => {
    if (method !== "stat") return;
    delivered = signal;
    signal.addEventListener("abort", event => { eventTarget = event.target; }, { once: true });
    enter();
    controller.abort(reason);
    signal.throwIfAborted();
  });
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const execution = shell.exec("cd /d", { signal: controller.signal });
    await assert.rejects(execution, error => error === reason);
    await entered;
    assert.equal(delivered?.reason, reason);
    assert.equal(delivered?.aborted, true);
    assert.equal(eventTarget, delivered);
  } finally { await shell.dispose(); }
});
