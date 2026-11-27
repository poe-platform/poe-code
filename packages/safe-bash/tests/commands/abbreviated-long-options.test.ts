import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../src/index.js";
import { fixture, run } from "./helpers.js";
import { createOdCommands } from "../../src/commands/od/index.js";

const cases = [
  ["printf '3\\n1\\n2\\n' | sort --num --rev", "3\n2\n1\n"],
  ["seq 3 | head --line=1", "1\n"],
  ["printf 'a\\n' | wc --line", "1\n"],
  ["printf 'a\\n' | cat --show-e", "a$\n"],
  ["printf 'a\\tb\\n' | expand --tab=2", "a b\n"],
  ["printf 'a\\n' | tr --del a", "\n"],
  ["printf 'hi' | base64 --wr=0; echo", "aGk=\n"],
  ["printf 'a\\n' | od --address=n --form=c", "   a  \\n\n"],
] as const;

for (const [script, stdout] of [...cases, [cases.map(([script]) => script).join("\n"), cases.map(([, stdout]) => stdout).join("")] as const]) {
  test(`GNU long-option abbreviations: ${script}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, stdout);
    } finally {
      await shell.dispose();
    }
  });
}

for (const [command, args, expected] of [
  ["head", ["--line", "-1"], "a\n"],
  ["tail", ["--line", "-1"], "b\n"],
  ["cat", ["--number"], "     1\ta\n     2\tb\n"],
  ["od", ["--address", "n", "--form", "c"], "   a  \\n   b  \\n\n"],
  ["od", ["--address=n", "--form=c", "--wid"], "   a  \\n   b  \\n\n"],
] as const) {
  test(`abbreviated options preserve arguments: ${command} ${args.join(" ")}`, async () => {
    const result = await run(command, args, { stdin: "a\nb\n", ...(command === "od" ? { commands: createOdCommands() } : {}) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

for (const [command, option] of [["sort", "--s"], ["cat", "--num"], ["cat", "--show"], ["od", "--s"]] as const) {
  test(`ambiguous options are rejected: ${command} ${option}`, async () => {
    const result = await run(command, [option], { stdin: "a\n", ...(command === "od" ? { commands: createOdCommands() } : {}) });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ambiguous/);
  });
}

test("od preserves option-looking values and filenames after --", async () => {
  const commands = createOdCommands();
  const invalid = await run("od", ["--form", "-c"], { stdin: "a\n", commands });
  assert.notEqual(invalid.exitCode, 0);
  assert.equal(invalid.stdout, "");
  const fs = await fixture({ "--form": "a\n" });
  const result = await run("od", ["--address=n", "--form=c", "--", "--form"], { fs, commands });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "   a  \\n\n");
});
