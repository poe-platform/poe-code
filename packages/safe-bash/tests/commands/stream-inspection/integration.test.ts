import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CommandRegistry, type PluginHost } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { Shell } from "../../../src/shell/index.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createStreamInspectionCommands, streamInspectionCommands } from "../../../src/commands/stream-inspection/index.js";

test("opt-in plugin collision preflight and replacement use existing contracts", () => {
  assert.deepEqual(createStreamInspectionCommands().map(command => command.name), ["tac", "expand", "fold", "strings"]);
  const original = { name: "strings", execute: () => ({ exitCode: 42 }) };
  const host: PluginHost = { commands: new CommandRegistry([original]), use() {}, registerFileSystem() {} };
  assert.throws(() => streamInspectionCommands().setup(host), /already registered/u);
  assert.deepEqual(host.commands.list().map(command => command.name), ["strings"]);
  streamInspectionCommands({ replace: true }).setup(host);
  assert.equal(host.commands.list().length, 4); assert.notEqual(host.commands.get("strings")?.execute, original.execute);
});

for (const backend of ["memory", "real"] as const) {
  test(`${backend}: Shell VFS log and binary inspection pipelines`, async () => {
    const directory = backend === "real" ? await mkdtemp(fileURLToPath(new URL("./author-real-", import.meta.url))) : undefined;
    const fs = directory ? await createRealFileSystem({ root: directory }) : createMemoryFileSystem();
    const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(streamInspectionCommands());
    try {
      const result = await shell.exec("printf 'old\tline\nnew\tline\n' > log; tac log | expand -t4 | fold -bw8 > report; cat report");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "new line\nold line\n");
      const binary = await shell.exec("printf '\\000MAGIC\\000payload\\000' > artifact; strings -a artifact | tac | head -n1");
      assert.equal(binary.exitCode, 0, binary.stderr); assert.equal(binary.stdout, "payload\n");
      const byteOutput = await shell.exec("printf '\\377\\000x\\nY\\n' | tac | cat > binary; cat binary");
      assert.equal(byteOutput.exitCode, 0, byteOutput.stderr); assert.equal(Buffer.from(byteOutput.stdoutBytes).toString("hex"), "590aff00780a");
      assert.equal(Buffer.from(await fs.readFile("/binary")).toString("hex"), "590aff00780a");
    } finally { await shell.dispose(); if (directory) await rm(directory, { recursive: true }); }
  });
}

test("actual shared shell output budget is not replaced by family limits", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 32 } }).use(standardCommands()).use(streamInspectionCommands());
  try {
    await assert.rejects(shell.exec("printf 'a\\tb\\n' | expand -t32 | cat"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});

test("early downstream pipeline closes input without processing full source", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/large", Buffer.from("abcd\tvalue\n".repeat(20000)));
  const shell = new Shell({ fs }).use(standardCommands()).use(streamInspectionCommands());
  try {
    const result = await shell.exec("expand /large | head -c4", { signal: AbortSignal.timeout(3000) });
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "abcd");
  } finally { await shell.dispose(); }
});
