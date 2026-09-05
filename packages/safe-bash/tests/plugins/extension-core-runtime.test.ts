import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled extension binding and input contracts", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const prefix of ["", "command ", "builtin "]) {
    test(`public declaration metadata preserves canonical values through ${prefix || "direct invocation"}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
        name: "capture-declaration", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "capture", expansion: "declaration", async execute(context) {
          const transaction = await context.bindings.prepare("captured", { kind: "indexed", clear: true });
          try {
            for (const [index, value] of context.argumentValues.entries()) await transaction.set(index, value);
            await transaction.commit();
          } finally { await transaction.close(); }
          assert.equal(context.bindings.describe("captured").kind, "indexed");
          return 0;
        } }] }),
      }] }).use(published.agentCommands());
      try {
        const result = await shell.exec(`value=$'\\xff z'; ${prefix}capture item=$value; printf '%s\\0' "\${captured[@]}"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "6974656d3dff207a00");
      } finally { await shell.dispose(); }
    });
  }

  test("public input descriptor aliases retain one cursor across borrowed lease release", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Uint8Array.of(255, 10, 116, 97, 105, 108, 10));
    const shell = new published.Shell({ fs, extensions: [{
      name: "borrowed-input", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "consume", async execute(context) {
        for (const [descriptor, name] of [[3, "first"], [4, "second"]] as const) {
          const lease = context.input.borrow(descriptor);
          try {
            const record = await lease.read(true);
            try { await context.bindings.assign(name, record.shellValue); }
            finally { await record.release(); }
          } finally { await lease.release(); }
          await assert.rejects(lease.read(true), /closed/u);
        }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec('consume 3</input 4<&3; printf "%s:%s" "$first" "$second"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff3a7461696c");
    } finally { await shell.dispose(); }
  });

  for (const [locale, expected] of [["C", "2"], ["en_US.UTF-8", "1"]] as const) {
    test(`public positional length expansion respects ${locale}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
      try {
        const result = await shell.exec('bash -c \'printf "%s" "${#1}"\' child "é"', { env: { LC_ALL: locale } });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
  }

  for (const locale of ["C", "en_US.UTF-8"]) {
    test(`public zero-prefixed positionals retain raw values and lengths in ${locale}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
      try {
        const result = await shell.exec("bash -c 'printf \"%s:%s:%s\" \"${01}\" \"${#01}\" \"${#0001}\"' child $'\\xff'", { env: { LC_ALL: locale } });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff3a313a31");
      } finally { await shell.dispose(); }
    });
  }
});
