import assert from "node:assert/strict";
import test from "node:test";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { trustedInputRows, reusableBatchRows } from "../../../src/commands/regex-execution/protocol.js";
import { rgCommand } from "../../../src/commands/search/rg.js";
import { grepCommands } from "../../../src/commands/grep.js";
import { Limits } from "../../../src/commands/search/shared.js";
import { Budget, lineRecordBatches } from "../../../src/commands/text-programs/shared.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { registerRuntimeBackingFileSystem } from "../../../src/fs/creation-mask.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

test("rg flush gives output sinks bytes that survive reuse by another invocation", async () => {
  const retained: Uint8Array[] = [];
  const context: CommandContext = {
    command: "rg", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(chunk) { retained.push(chunk); } },
    stderr: { async write() {} },
  };
  const first = new Limits(context, {});
  await first.output("TENANT_FIRST\n");
  await first.flush();
  const second = new Limits(context, {});
  await second.output("TENANT_OTHER\n");
  await second.flush();
  assert.equal(Buffer.from(retained[0]!).toString(), "TENANT_FIRST\n");
});

test("text record offsets remain owned while another generator advances", async () => {
  const context: CommandContext = {
    command: "sed", args: [], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    stdin: toByteSource("a\nbbbb\n"), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  const first = lineRecordBatches(context, [], new Budget(context, {}));
  const other = { ...context, stdin: toByteSource("longer\nx\n") };
  const second = lineRecordBatches(other, [], new Budget(other, {}));
  try {
    const batch = await first.next();
    await second.next();
    assert.equal(batch.done, false);
    assert.deepEqual(Array.from(batch.value!.ends), [1, 6]);
  } finally {
    await first.return(undefined);
    await second.return(undefined);
  }
});

for (const fixed of [false, true]) {
  test(`retained synchronous regex results survive another tenant (${fixed ? "literal" : "ERE"})`, async () => {
    const executor = new RegexExecutor(createBoundedRegexProvider());
    const session = executor.open(new AbortController().signal);
    const descriptor = { kind: "grep", patterns: ["secret"], fixed, extended: true, insensitive: false, whole: false, word: false } as const;
    const rows = (texts: string[]) => {
      const batch = texts.map(text => ({ bytes: Buffer.from(text), all: false, terminated: true }));
      trustedInputRows.add(batch);
      reusableBatchRows.add(batch);
      return batch;
    };
    try {
      const first = session.runSync(descriptor, rows(["secret", "absent"]));
      assert.ok(!(first instanceof Promise), "exercise the synchronous pooled result path");
      const second = session.runSync(descriptor, rows(["absent", "secret"]));
      assert.ok(!(second instanceof Promise));
      assert.deepEqual(first, [[{ start: 0, end: 6 }], []]);
      assert.deepEqual(second, [[], [{ start: 0, end: 6 }]]);
    } finally {
      await session.close();
      await executor.dispose();
    }
  });
}

for (const tool of ["rg", "grep"] as const) {
  test(`${tool} concurrent async output preserves invocation-owned lines`, async () => {
    await Promise.all(Array.from({ length: 24 }, async (_, id) => {
      const fs = new MemoryFileSystem();
      registerRuntimeBackingFileSystem(fs, fs);
      const contents = `${id}_secret_a\n${id}_secret_b\n`;
      await fs.mkdir("/data");
      await fs.writeFile("/data/input", Buffer.from(contents));
      const output: Uint8Array[] = [];
      const command = tool === "rg" ? rgCommand() : grepCommands()[0]!;
      const result = await command.execute({
        command: tool, args: ["-n", ...(tool === "grep" ? ["--line-buffered"] : ["-I"]), "-F", `${id}_secret`, tool === "rg" ? "/data" : "/data/input"], cwd: "/", env: {}, fs,
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: { async write(chunk) { await Promise.resolve(); output.push(chunk.slice()); } },
        stderr: { async write(chunk) { assert.fail(Buffer.from(chunk).toString()); } },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.concat(output).toString(), `1:${id}_secret_a\n2:${id}_secret_b\n`);
    }));
  });
}
