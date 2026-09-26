import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { standardCommands } from "../../src/commands/index.js";

for (const source of ["mkdir /d1 | head -n 1", "find / -size 0 | sed s/a/b/", "rm -rf /d1 | head -n 1"]) {
  test(`pipeline host filesystem receives native signals: ${source}`, async () => {
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
