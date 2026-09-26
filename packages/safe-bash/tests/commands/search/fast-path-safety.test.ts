import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { createGrepCommands } from "../../../src/commands/search/grep.js";
import { Shell, agentCommands } from "../../../src/index.js";
import { fixture, run } from "../helpers.js";

for (const command of ["grep hello /work/input", "grep -i hello /work/input", "rg hello /work/input", "rg -c hello /work/input", "rg -l hello /work/input"]) {
  test(`${command} enforces the filesystem operation budget`, async () => {
    const fs = await fixture({ input: "hello\n" });
    const shell = new Shell({ fs }).use(agentCommands());
    assert.equal((await shell.exec(command)).exitCode, 0);
    try {
      const result = await shell.exec(command, { limits: { maxFileSystemOperations: 0 } });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
    } catch (error) {
      assert.equal((error as Error).name, "ShellLimitError");
    }
  });
}

for (const bytes of [Buffer.from("hello\0world\n"), Buffer.from([104, 101, 108, 108, 111, 255, 10]), Buffer.from([255, 10]), Buffer.from([104, 101, 108, 108, 111, 195, 10])]) {
  for (const input of ["file", "stdin"] as const) {
    test(`ASCII grep rejects invalid subject ${bytes.toString("hex")} from ${input}`, async () => {
      const fs = await fixture({ input: bytes });
      const result = await run("grep", ["hello", input === "file" ? "input" : "-"], { fs, commands: createGrepCommands(new RegexExecutor(createBoundedRegexProvider())), ...(input === "stdin" ? { stdin: bytes } : {}) });
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, /valid non-NUL UTF-8/);
      assert.equal(result.stdout, "");
    });
  }
}

test("ASCII grep yields while scanning large nonmatching input", async () => {
  const fs = await fixture({ input: "miss\n".repeat(40_000) });
  let yielded = false;
  const timer = setTimeout(() => { yielded = true; }, 0);
  try {
    assert.equal((await run("grep", ["hello", "input"], { fs, commands: createGrepCommands(new RegexExecutor(createBoundedRegexProvider())) })).exitCode, 1);
    assert.equal(yielded, true);
  } finally { clearTimeout(timer); }
});

test("ASCII grep preserves valid UTF-8 subjects and anchored matching", async () => {
  const fs = await fixture({ input: "hello café 🌍\nother hello\n" });
  const result = await run("grep", ["^hello", "input"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello café 🌍\n");
});
