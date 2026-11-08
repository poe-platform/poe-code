import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled incremental indexed bindings", { skip: selected === undefined ? "Requires a current optional build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const index of [2147483648, 4294967295]) for (const consumer of ["binding", "element"]) {
    test(`public uint32 cell round-trips through ${consumer}: ${index}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
        name: "incremental-high-index", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "fill", async execute(context) {
          const writer = await context.bindings.openIndexed("items", { clear: true });
          try {
            await writer.set(index, "high");
            if (consumer === "binding") assert.equal(context.bindings.get("items", index), "high");
          } finally { await writer.close(); }
          return 0;
        } }] }),
      }] }).use(published.agentCommands());
      try {
        const source = consumer === "binding" ? "fill" : `fill; printf '<%s>' "\${items[${index}]}"`;
        const result = await shell.exec(source);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, consumer === "binding" ? "" : "<high>");
      } finally { await shell.dispose(); }
    });
  }

  for (const readonly of [false, true]) test(`public outer writer cannot mutate a local shadow: readonly=${readonly}`, async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    let outer: { set(index: number, value: string): Promise<void>; close(): Promise<void> } | undefined;
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "incremental-local-shadow", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "fill", async execute(context) {
        if (context.args[0] === "shadow") {
          assert.equal(context.bindings.describe("items").readonly, readonly);
          await assert.rejects(outer!.set(1, "leaked"), /identity|target/u);
          return 0;
        }
        outer = await context.bindings.openIndexed("items", { clear: true });
        try {
          await outer.set(0, "outer");
          await context.evaluate(`inspect() { local items=inner; ${readonly ? "readonly items; " : ""}fill shadow; printf 'local=<%s>\\n' "$items"; }; inspect`);
          await outer.set(1, "tail");
        } finally { await outer.close(); }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec('fill; printf "outer=<%s>\\n" "${items[@]}"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "local=<inner>\nouter=<outer>\nouter=<tail>\n");
    } finally { await shell.dispose(); }
  });

  test("admitted writes retain bytes after a callback adds readonly", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "incremental-readonly", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "fill", async execute(context) {
        const writer = await context.bindings.openIndexed("items", { clear: true });
        try {
          await writer.set(0, context.argumentValues[0]!);
          await context.evaluate('printf "before=<%s>\\n" "${items[@]}"; readonly items');
          await writer.set(1, "tail");
          assert.equal(context.bindings.describe("items").readonly, true);
        } finally { await writer.close(); }
        await assert.rejects(writer.set(2, "late"), /closed/u);
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec('items=(old); fill $\'\\xff\'; printf "after=<%s>\\n" "${items[@]}"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), Buffer.concat([
        Buffer.from("before=<"), Buffer.from([255]), Buffer.from(">\nafter=<"), Buffer.from([255]), Buffer.from(">\nafter=<tail>\n"),
      ]).toString("hex"));
    } finally { await shell.dispose(); }
  });

  test("callback replacement remains the visible target of the next write", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "incremental-replacement", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "fill", async execute(context) {
        const writer = await context.bindings.openIndexed("items", { clear: true });
        try {
          await writer.set(0, "first");
          await context.evaluate("items=(replacement)");
          await writer.set(1, "tail");
        } finally { await writer.close(); }
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec('fill; printf "<%s>" "${items[@]}"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "<replacement><tail>");
    } finally { await shell.dispose(); }
  });

  test("scalar command prefixes restore the prior binding after indexed promotion", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "incremental-prefix", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "fill", async execute(context) {
        const writer = await context.bindings.openIndexed("items", { clear: true });
        try { await writer.set(0, "new"); await writer.set(1, "tail"); }
        finally { await writer.close(); }
        await context.evaluate('printf "inside=<%s>\\n" "${items[@]}"');
        return 0;
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec('items=old; items=temporary fill; printf "outside=<%s>\\n" "${items[@]}"');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "inside=<new>\ninside=<tail>\noutside=<old>\n");
    } finally { await shell.dispose(); }
  });
});
