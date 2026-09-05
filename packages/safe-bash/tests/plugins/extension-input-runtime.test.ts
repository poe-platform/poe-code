import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled extension replacement and raw input", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const name of ["read", "type", "command", "builtin"]) {
    test(`public explicit replacement dispatches ${name}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const calls: string[][] = [];
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
        name: "replacement", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name, replace: true, execute(context) {
          calls.push([context.command, ...context.args]);
          return 7;
        } }] }),
      }] }).use(published.agentCommands());
      try {
        for (const prefix of ["", "command ", "builtin "]) {
          const result = await shell.exec(`${prefix}${name} payload`);
          assert.equal(result.exitCode, 7, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, "");
          assert.deepEqual(calls.at(-1), [name, ...(prefix.trim() === name ? [name] : []), "payload"]);
        }
      } finally { await shell.dispose(); }
    });
  }

  test("public raw records preserve bytes and share aliased descriptor position", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("ff00610a62007461696c0a", "hex"));
    const shell = new published.Shell({ fs, extensions: [{
      name: "raw-record", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "consume", async execute(context) {
        for (const [descriptor, name, delimiter] of [[3, "first", 10], [4, "second", 0]] as const) {
          const lease = context.input.borrow(descriptor);
          try {
            const record = await lease.record({ delimiter });
            try {
              assert.equal(record.reason, "delimiter");
              await context.bindings.assign(name, record.shellValue);
            } finally { await record.release(); }
          } finally { await lease.release(); }
          await assert.rejects(lease.record(), /closed/u);
          assert.throws(() => lease.readiness(), /closed/u);
        }
        const lease = context.input.borrow(3);
        try {
          const record = await lease.read(true);
          try { await context.bindings.assign("tail", record.shellValue); }
          finally { await record.release(); }
        } finally { await lease.release(); }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec('consume 3</input 4<&3; printf "%s|%s|%s" "$first" "$second" "$tail"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff00610a7c62007c7461696c");
    } finally { await shell.dispose(); }
  });

  test("public opaque input stays unknown and invalid deadlines do not consume", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    let pulls = 0;
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "readiness", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "inspect", async execute(context) {
        const lease = context.input.borrow(0);
        try {
          assert.equal(lease.readiness(), "unknown");
          for (const timeoutMs of [0, -1, Infinity, NaN]) await assert.rejects(lease.read(true, { timeoutMs }), /options/u);
          await assert.rejects(lease.read(true, { timeoutMs: 10 }), /provenance/u);
          assert.equal(pulls, 0);
          const record = await lease.record();
          try { await context.bindings.assign("result", record.shellValue); }
          finally { await record.release(); }
        } finally { await lease.release(); }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec('inspect; printf "%s" "$result"', { stdin: {
        async *[Symbol.asyncIterator]() { pulls++; yield Buffer.from("untouched\n"); },
      } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "untouched\n");
      assert.equal(pulls, 1);
    } finally { await shell.dispose(); }
  });
});
