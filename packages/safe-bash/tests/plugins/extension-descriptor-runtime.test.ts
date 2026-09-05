import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled extension diagnostics and descriptor validation", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const invocation of ["probe", "command probe", "builtin probe"]) {
    test(`diagnostics retain raw argument bytes through ${invocation}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
        name: "diagnostic-bytes", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "probe", async execute(context) {
          await context.diagnostic(context.argumentValues[0] ?? "");
          return 0;
        } }] }),
      }] }).use(published.agentCommands());
      try {
        const result = await shell.exec(`${invocation} $'\\377\\376'`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.deepEqual(result.stderrBytes, new Uint8Array([...Buffer.from("shell: line 1: "), 255, 254, 10]));
      } finally { await shell.dispose(); }
    });
  }

  for (const invocation of ["probe", "command probe", "builtin probe"]) {
    test(`write-only aliases validate without consuming stdin through ${invocation}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const fs = createMemoryFileSystem();
      const shell = new published.Shell({ fs, extensions: [{
        name: "descriptor-validation", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "probe", async execute(context) {
          for (const descriptor of [0, 1, 2, 3, 4]) assert.equal(context.input.validateOpen(descriptor), undefined);
          for (const descriptor of [3, 4]) assert.throws(() => context.input.borrow(descriptor), { code: "EBADF" });
          const lease = context.input.borrow(0);
          try {
            const record = await lease.read(true);
            try {
              assert.equal(record.value, "untouched");
              assert.equal(record.reason, "delimiter");
            } finally { await record.release(); }
          } finally { await lease.release(); }
          return 0;
        } }] }),
      }] }).use(published.agentCommands());
      try {
        const result = await shell.exec(`${invocation} 3>/output 4>&3`, { stdin: "untouched\n" });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.equal((await fs.stat("/output")).size, 0);
      } finally { await shell.dispose(); }
    });
  }

  for (const script of ["probe", "probe 9>&-"]) {
    test(`missing and closed descriptors reject without consuming input: ${script}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
        name: "closed-descriptor", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "probe", async execute(context) {
          assert.throws(() => context.input.validateOpen(9), { code: "EBADF" });
          for (const descriptor of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            assert.throws(() => context.input.validateOpen(descriptor), RangeError);
          }
          const lease = context.input.borrow(0);
          try {
            const record = await lease.read(true);
            try { assert.equal(record.value, "untouched"); }
            finally { await record.release(); }
          } finally { await lease.release(); }
          return 0;
        } }] }),
      }] }).use(published.agentCommands());
      try {
        const result = await shell.exec(script, { stdin: "untouched\n" });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
  }

  test("descriptor validation expires with its extension invocation", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    let retained: { validateOpen(descriptor: number): void } | undefined;
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "expired-descriptor", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "probe", async execute(context) {
        assert.equal(context.input.validateOpen(1), undefined);
        retained = context.input;
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec("probe");
      assert.equal(result.exitCode, 0, result.stderr);
      const expired = retained;
      assert.ok(expired);
      assert.throws(() => expired.validateOpen(1));
    } finally { await shell.dispose(); }
  });

  test("descriptor validation observes the exact root cancellation reason", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const controller = new AbortController();
    const untouched = Symbol("not observed");
    let observed: unknown = untouched;
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "cancelled-descriptor", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "probe", async execute(context) {
        const input = context.input;
        controller.abort(false);
        try { input.validateOpen(0); }
        catch (error) { observed = error; }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      await assert.rejects(shell.exec("probe", { signal: controller.signal }), error => error === false);
      assert.equal(observed, false);
    } finally { await shell.dispose(); }
  });
});
