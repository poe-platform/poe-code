import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled owning-source readiness", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("public finite input admits its intrinsic byte extent", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    const bytes = Uint8Array.of(65, 66, 67);
    Object.defineProperty(bytes, "byteLength", { value: 1 });
    try {
      await assert.rejects(shell.exec("cat", { stdin: bytes, limits: { maxInputBytes: 2 } }), { code: "EFBIG" });
    } finally { await shell.dispose(); }
  });

  test("public finite input does not mistake a shadowed byte extent for EOF", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    const bytes = Uint8Array.of(65, 66, 67);
    Object.defineProperty(bytes, "byteLength", { value: 0 });
    try {
      const result = await shell.exec("cat", { stdin: bytes, limits: { maxInputBytes: 3 } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(65, 66, 67));
    } finally { await shell.dispose(); }
  });

  for (const script of ["cat <<EOF\néé\nEOF\n", "cat <<<éé"]) {
    test(`transport preserves the five-byte expansion boundary: ${JSON.stringify(script)}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
      try {
        await assert.rejects(shell.exec(script, { limits: { maxExpansionBytes: 4 } }),
          error => error instanceof published.ShellLimitError && error.limit === "maxExpansionBytes");
        const result = await shell.exec(script, { limits: { maxExpansionBytes: 5 } });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.from("éé\n")));
      } finally { await shell.dispose(); }
    });
  }

  for (const script of ["probe", "eval probe", "bash -c probe", "probe <<EOF\npayload\nEOF\n"]) {
    test(`finite input capabilities survive public execution: ${JSON.stringify(script)}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      let calls = 0;
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
        name: "prepared-input", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "probe", async execute(context) {
          calls++;
          const lease = context.input.borrow(0);
          try {
            assert.equal(lease.readiness(), "ready");
            const record = await lease.read(true, { timeoutMs: 1000 });
            try {
              assert.equal(record.value, "payload");
              assert.equal(record.reason, "delimiter");
            } finally { await record.release(); }
            assert.equal(lease.readiness(), "eof");
            return 0;
          } finally { await lease.release(); }
        } }] }),
      }] }).use(published.agentCommands());
      try {
        const result = await shell.exec(script, { stdin: "payload\n" });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "");
        assert.equal(calls, 1);
      } finally { await shell.dispose(); }
    });
  }

  test("public regular-file aliases share position and report established EOF", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("one\ntwo\n"));
    const shell = new published.Shell({ fs, extensions: [{
      name: "prepared-file", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "probe", async execute(context) {
        for (const [descriptor, value] of [[3, "one"], [4, "two"], [3, ""]] as const) {
          const lease = context.input.borrow(descriptor);
          try {
            assert.equal(lease.readiness(), "ready");
            const record = await lease.read(true, { timeoutMs: 0.001 });
            try {
              assert.equal(record.value, value);
              assert.equal(record.reason, value ? "delimiter" : "eof");
            } finally { await record.release(); }
            assert.equal(lease.readiness(), value ? "ready" : "eof");
          } finally { await lease.release(); }
        }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec("probe 3</input 4<&3");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  });

  test("public retained regular input reads an append after an earlier EOF", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("one\n"));
    const shell = new published.Shell({ fs, extensions: [{
      name: "retained-input", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "probe", async execute(context) {
        const lease = context.input.borrow(3);
        try {
          for (const value of ["one", "", "two"]) {
            if (value === "two") assert.equal(await context.evaluate("printf 'two\\n' >>/input"), 0);
            const record = await lease.read(true, { timeoutMs: 0.001 });
            try {
              assert.equal(record.value, value);
              assert.equal(record.reason, value ? "delimiter" : "eof");
            } finally { await record.release(); }
          }
          return 0;
        } finally { await lease.release(); }
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec("probe 3</input");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  });
});
