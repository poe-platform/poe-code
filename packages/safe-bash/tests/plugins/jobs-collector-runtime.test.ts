import assert from "node:assert/strict";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

describe("compiled optional collector ownership", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"]) for (const alias of [false, true]) {
    test(`${route}: redirected child ${alias ? "retains an explicit fd3 writer" : "releases replaced stdout"}`, { timeout: 3000 }, async context => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
      const entered = deferred();
      const release = deferred();
      const captured = deferred();
      const parent = deferred();
      const controller = new AbortController();
      const resources: { shell?: InstanceType<typeof published.Shell>; execution?: Promise<unknown> } = {};
      let active = 0;
      let acquired = 0;
      let cleaned = 0;
      const deadline = setTimeout(() => controller.abort(new Error("compiled collector ownership deadline")), 800);
      context.after(async () => {
        clearTimeout(deadline);
        controller.abort(new Error("compiled collector teardown"));
        release.resolve();
        await resources.execution?.catch(() => undefined);
        await resources.shell?.dispose();
        assert.equal(active, 0);
        assert.equal(cleaned, acquired);
      });
      const fs = createMemoryFileSystem();
      const extension = optional.jobsExtension();
      assert.equal(extension.runtimeIdentity, published.commandRuntimeIdentity);
      const shell = new published.Shell({ fs, extensions: [extension], limits: { maxWallClockMs: 1000, maxOutputBytes: 65536 } }).use(published.agentCommands());
      resources.shell = shell;
      shell.register({ name: "review_hold", runtimeIdentity: published.commandRuntimeIdentity, async execute(invocation) {
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
        acquired++;
        invocation.signal.addEventListener("abort", cleanup, { once: true });
        entered.resolve();
        try {
          await release.promise;
          invocation.signal.throwIfAborted();
          await invocation.stdout.write(new TextEncoder().encode("FILE"));
          return { exitCode: 0 };
        } finally { cleanup(); }
      } });
      shell.register({ name: "review_capture", runtimeIdentity: published.commandRuntimeIdentity, execute() {
        captured.resolve();
        return { exitCode: 0 };
      } });
      shell.register({ name: "review_parent", runtimeIdentity: published.commandRuntimeIdentity, execute() {
        parent.resolve();
        release.resolve();
        return { exitCode: 0 };
      } });
      const child = alias ? "{ review_hold; printf ALIAS >&3; } 3>&1 >/output" : "review_hold >/output";
      const source = `value=$(${child} & printf CAPTURE; review_capture); review_parent; printf '<%s>' "$value"`;
      if (route !== "inline") await fs.writeFile("/collector.sh", new TextEncoder().encode(source));
      const result = shell.exec(route === "inline" ? source : `${route} /collector.sh`, { signal: controller.signal, env: { LC_ALL: "C" } });
      resources.execution = result;
      void result.catch(() => undefined);
      const premature = result.then(() => { throw new Error("execution ended before collector ownership checkpoint"); });
      void premature.catch(() => undefined);
      await Promise.race([Promise.all([entered.promise, captured.promise]), premature]);
      if (alias) {
        let continued = false;
        void parent.promise.then(() => { continued = true; });
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(continued, false);
        release.resolve();
      } else await Promise.race([parent.promise, premature]);
      const actual = await result;
      assert.equal(actual.exitCode, 0);
      assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from(alias ? "<CAPTUREALIAS>" : "<CAPTURE>"));
      assert.equal(actual.stderr, "");
      assert.deepEqual(await fs.readFile("/output"), new TextEncoder().encode("FILE"));
      assert.equal(acquired, 1);
      assert.equal(cleaned, 1);
      assert.equal(active, 0);
    });
  }
});
