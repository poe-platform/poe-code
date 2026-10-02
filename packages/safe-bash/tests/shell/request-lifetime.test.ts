import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, createOverlayFileSystem, createMountFileSystem, createReadOnlyFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { InvocationScope } from "../../src/shell/cleanup.js";

test("concurrent shells retain their own results across asynchronous root cleanup", async context => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const close = InvocationScope.prototype.close;
  let paused = false;
  context.mock.method(InvocationScope.prototype, "close", function (this: InvocationScope) {
    if (this.parent !== undefined || paused) return close.call(this);
    paused = true;
    enter();
    return released.then(() => close.call(this));
  });
  const first = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands());
  const second = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands());
  const pending = first.exec("echo first; echo first-error >&2; exit 7");
  try {
    await entered;
    const other = await second.exec("echo second; echo second-error >&2; exit 9");
    release();
    const result = await pending;
    assert.equal(result.stdout, "first\n");
    assert.equal(result.stderr, "first-error\n");
    assert.equal(result.exitCode, 7);
    assert.equal(other.stdout, "second\n");
    assert.equal(other.stderr, "second-error\n");
    assert.equal(other.exitCode, 9);
  } finally {
    release();
    await pending;
    await first.dispose();
    await second.dispose();
  }
});

for (const source of ["mkdir /d1", "find / -size 0", "rm -rf /d1", "mkdir /d1 | head -n 1", "find / -size 0 | sed s/a/b/", "rm -rf /d1 | head -n 1"]) {
  test(`host filesystem receives native signals: ${source}`, async () => {
    const backing = createMemoryFileSystem();
    let checked = 0;
    const fs = new Proxy(backing, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          const options = args.at(-1) as { signal?: AbortSignal } | undefined;
          if (options?.signal) {
            AbortSignal.prototype.throwIfAborted.call(options.signal);
            new Request("https://example.test", { signal: options.signal });
            checked++;
          }
          return member.apply(target, args);
        };
      },
    });
    const shell = new Shell({ fs }).use(standardCommands()).use(structuredCommands()).use(textProgramCommands());
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.ok(checked > 0);
    } finally { await shell.dispose(); }
  });
}

async function completedRequest(source: string, captureState: boolean, memory: boolean): Promise<WeakRef<object>[]> {
  const backing = createMemoryFileSystem();
  const fs = memory ? backing : new Proxy(backing, {});
  const controller = new AbortController();
  const shell = new Shell({ fs, env: { TENANT_SECRET: "synthetic-tenant-secret" } }).use(standardCommands()).use(structuredCommands()).use(textProgramCommands());
  let result = await shell.exec(source, { signal: controller.signal, ...(captureState ? { onState() {} } : {}) });
  assert.equal(result.exitCode, 0, result.stderr);
  await shell.dispose();
  const refs = [new WeakRef(fs), new WeakRef(controller.signal), new WeakRef(result)];
  result = undefined!;
  return refs;
}

for (const source of ["echo $TENANT_SECRET", "echo one | cat", "mkdir /d1", "mkdir /d1 | head -n 1", "printf '{}\\n' | jq --arg secret synthetic-secret .", "printf 'secret\\n' | awk '{print}'"]) {
  for (const [captureState, memory] of [[false, false], [true, false], [false, true]] as const) {
    test(`completed request releases host resources: ${source}, state=${captureState}, memory=${memory}`, { skip: !globalThis.gc }, async () => {
      const refs = await completedRequest(source, captureState, memory);
      for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve));
        globalThis.gc!();
      }
      assert.deepEqual(refs.map(ref => ref.deref() === undefined), [true, true, true]);
    });
  }
}

test("fast pipeline native host signal propagates caller cancellation", async () => {
  const backing = createMemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("synthetic cancellation");
  let admit!: () => void;
  const admitted = new Promise<void>(resolve => { admit = resolve; });
  let hostSignal: AbortSignal | undefined;
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "mkdir") return async (_path: string, options: { signal: AbortSignal }) => {
        hostSignal = options.signal;
        AbortSignal.prototype.throwIfAborted.call(hostSignal);
        admit();
        await new Promise<void>((_resolve, reject) => {
          hostSignal!.addEventListener("abort", () => reject(hostSignal!.reason), { once: true });
        });
      };
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const shell = new Shell({ fs }).use(standardCommands());
  const execution = shell.exec("mkdir /d1 | head -n 1", { signal: controller.signal });
  const rejected = assert.rejects(execution, error => error === reason);
  await admitted;
  controller.abort(reason);
  await rejected;
  assert.equal(hostSignal!.aborted, true);
  assert.equal(hostSignal!.reason, reason);
  await shell.dispose();
});

for (const kind of ["overlay", "mount", "readonly"] as const) {
  for (const cancel of [false, true]) test(`awk completion releases ${kind} filesystem, state and output (cancel=${cancel})`, { skip: !globalThis.gc }, async () => {
    const refs = await (async () => {
      const backing = createMemoryFileSystem();
      const fs = kind === "overlay" ? createOverlayFileSystem({ lower: backing, upper: createMemoryFileSystem() })
        : kind === "mount" ? createMountFileSystem({ root: backing }) : createReadOnlyFileSystem(backing);
      const controller = new AbortController();
      const references: WeakRef<object>[] = [new WeakRef(fs)];
      const shell = new Shell({ fs, env: { SECRET: "synthetic-secret" } }).use(standardCommands()).use(textProgramCommands());
      const stdin = {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode("private input\n");
          if (cancel) controller.abort(new Error("cancelled awk"));
        },
      };
      try {
        const execution = shell.exec("private=value; echo private-error >&2; awk '{print}'", {
          stdin, signal: controller.signal,
          onState(state) { references.push(new WeakRef(state)); },
        });
        if (cancel) await assert.rejects(execution);
        else {
          const result = await execution;
          assert.equal(result.exitCode, 0, result.stderr);
          references.push(new WeakRef(result.stdoutBytes), new WeakRef(result.stderrBytes));
        }
      } finally { await shell.dispose(); }
      return references;
    })();
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise<void>(resolve => setImmediate(resolve));
      globalThis.gc!();
    }
    assert.deepEqual(refs.map(ref => ref.deref() === undefined), refs.map(() => true));
  });
}
