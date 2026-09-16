import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled descriptor observation", { skip: selected === undefined ? "Requires a current build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const entry of ["inline", "bash", "sh"]) test(`public write-only observation preserves output admission: ${entry}`, async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    const shell = new published.Shell({ fs, extensions: [{
      name: "descriptor-observer", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "inspectfd", async execute(invocation) {
        const observer = invocation.input.observe(1);
        assert.equal(observer.readable, false);
        assert.throws(() => invocation.input.borrow(1), { code: "EBADF" });
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
        assert.equal(await observer.waitRead({ timeoutMs: 1 }), "ready");
        await observer.release();
        await observer.release();
        await assert.rejects(observer.probeRead(), { code: "EBADF" });
        await invocation.stdout.write(Uint8Array.of(97, 0, 255));
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const source = "inspectfd 3>out 1>&3";
    if (entry !== "inline") await fs.writeFile("/program.sh", Buffer.from(source));
    const result = await shell.exec(entry === "inline" ? source : `${entry} /program.sh`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new Uint8Array());
    assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(97, 0, 255));
  });

  test("public observer retains an aliased resource across rename and replacement", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    const shell = new published.Shell({ fs, extensions: [{
      name: "descriptor-observer", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "inspectfd", async execute(invocation) {
        const observer = invocation.input.observe(4);
        await fs.rename("/out", "/moved");
        await fs.mkdir("/out");
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
        await observer.release();
        await invocation.stdout.write(Uint8Array.of(98));
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec("inspectfd 3>out 4>&3 1>&4");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/moved"), Uint8Array.of(98));
    assert.equal((await fs.stat("/out")).type, "directory");
  });

  test("public readable observation leaves the raw aliased cursor untouched", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Uint8Array.of(255, 0, 97, 10));
    const shell = new published.Shell({ fs, extensions: [{
      name: "descriptor-observer", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "inspectfd", async execute(invocation) {
        const observer = invocation.input.observe(3);
        assert.equal(observer.readable, true);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
        await observer.release();
        const lease = invocation.input.borrow(4);
        try {
          const record = await lease.record();
          try { await invocation.bindings.assign("result", record.shellValue); }
          finally { await record.release(); }
        } finally { await lease.release(); }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec('inspectfd 3<input 4<&3; printf "%s" "$result"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 0, 97, 10));
  });

  test("public opaque streams stay unknown without starting a producer", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    let pulls = 0;
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "descriptor-observer", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "inspectfd", async execute(invocation) {
        for (const descriptor of [0, 1]) {
          const observer = invocation.input.observe(descriptor);
          assert.equal(observer.readable, descriptor === 0);
          assert.deepEqual(await observer.probeRead(), { readiness: "unknown", timeout: "unknown" });
          assert.equal(await observer.waitRead({ timeoutMs: 1 }), "unknown");
          await observer.release();
        }
        assert.equal(pulls, 0);
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec("inspectfd", { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(97); } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(pulls, 0);
  });

  for (const reason of [false, 0, "", null]) test(`public local observation cancellation preserves its exact reason: ${String(reason)}`, async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    const shell = new published.Shell({ fs, extensions: [{
      name: "descriptor-observer", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "inspectfd", async execute(invocation) {
        const observer = invocation.input.observe(1);
        const controller = new AbortController();
        controller.abort(reason);
        await assert.rejects(observer.waitRead({ timeoutMs: 1, signal: controller.signal }), error => Object.is(error, reason));
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
        await observer.release();
        await invocation.stdout.write(Uint8Array.of(99));
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec("inspectfd >out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(99));
  });
});
