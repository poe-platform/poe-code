import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { Shell } from "../../../../src/shell/shell.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

for (const alias of [false, true]) {
  test(`adapted collector ownership: redirected child ${alias ? "retains explicit fd3 writer" : "does not retain replaced stdout"}`, { timeout: 2000 }, async context => {
    const entered = deferred();
    const release = deferred();
    const captured = deferred();
    const parent = deferred();
    const controller = new AbortController();
    const fs = createMemoryFileSystem();
    const owned: { shell?: Shell; execution?: Promise<unknown> } = {};
    let active = 0;
    let cleaned = 0;
    const safety = setTimeout(() => controller.abort(new Error("collector ownership safety deadline")), 800);
    context.after(async () => {
      clearTimeout(safety);
      controller.abort(new Error("collector ownership teardown"));
      release.resolve();
      await owned.execution?.catch(() => undefined);
      await owned.shell?.dispose();
      assert.equal(active, 0);
      assert.equal(cleaned, 1);
    });
    const shell = owned.shell = new Shell({ fs, extensions: [jobsExtension()], limits: { maxWallClockMs: 1000, maxOutputBytes: 65536 } });
    for (const command of basicCommands()) shell.register(command);
    shell.register({ name: "review_hold", async execute(invocation) {
      let admitted = false;
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        invocation.signal.removeEventListener("abort", cleanup);
        if (admitted) { active--; cleaned++; }
        release.resolve();
      };
      assert.equal(typeof invocation.registerCleanup, "function");
      invocation.registerCleanup!(cleanup);
      invocation.signal.throwIfAborted();
      admitted = true;
      active++;
      invocation.signal.addEventListener("abort", cleanup, { once: true });
      entered.resolve();
      try {
        await release.promise;
        invocation.signal.throwIfAborted();
        await invocation.stdout.write(new TextEncoder().encode("FILE"));
        return { exitCode: 0 };
      } finally { cleanup(); }
    } });
    shell.register({ name: "review_capture", execute() { captured.resolve(); return { exitCode: 0 }; } });
    shell.register({ name: "review_parent", execute() { parent.resolve(); release.resolve(); return { exitCode: 0 }; } });
    const child = alias ? "{ review_hold; printf ALIAS >&3; } 3>&1 >/output" : "review_hold >/output";
    const result = shell.exec(`value=$(${child} & printf CAPTURE; review_capture); review_parent; printf '<%s>' "$value"`, { signal: controller.signal });
    owned.execution = result;
    void result.catch(() => undefined);
    const premature = result.then(() => { throw new Error("execution ended before ownership checkpoint"); });
    void premature.catch(() => undefined);
    await Promise.race([Promise.all([entered.promise, captured.promise]), premature]);
    if (alias) {
      let continued = false;
      void parent.promise.then(() => { continued = true; });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(continued, false, "fd3 still owns a substitution writer despite redirected stdout");
      release.resolve();
    } else await Promise.race([parent.promise, premature]);
    const actual = await result;
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, alias ? "<CAPTUREALIAS>" : "<CAPTURE>");
    assert.deepEqual(await fs.readFile("/output"), new TextEncoder().encode("FILE"));
    assert.equal(active, 0);
    assert.equal(cleaned, 1);
  });
}
