import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

const commands = textCommands();

for (const selection of [
  "-d: -f1 --fields=2",
  "-d: -f1 -f1",
  "-b1 -b1",
  "--bytes=1 -b2",
  "--characters=1 -c2",
  "-c1 -c1",
  "--f=1 --fields 2 -d:",
  "-b1 -c2",
]) {
  for (const source of ["stdin", "file"]) {
    test(`cut rejects repeated lists (${source}): ${selection}`, async () => {
      const shell = new Shell({ fs: await fixture({ input: "left:right\nlast:field" }), cwd: "/work", commands: new CommandRegistry(commands) });
      try {
        const result = await shell.exec(`cut ${selection} ${source === "stdin" ? "< input" : "input"}`);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /only one list may be specified/);
      } finally { await shell.dispose(); }
    });
  }
}

for (const selection of ["-d: -f1,2", "-b1-", "-c1-"]) {
  test(`cut preserves a single list with multiple positions: ${selection}`, async () => {
    const shell = new Shell({ fs: await fixture({ input: "left:right\nlast:field" }), cwd: "/work", commands: new CommandRegistry(commands) });
    try {
      const result = await shell.exec(`cut ${selection} input`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "left:right\nlast:field\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const { args, output } of [
  { args: ["--comp", "-b2"], output: "ab:c\n" },
  { args: ["--complement", "-b2"], output: "ab:c\n" },
  { args: ["--out", "/", "-b1,3"], output: "a/b\n" },
  { args: ["--out=/", "-b1,3"], output: "a/b\n" },
  { args: ["--b=1,3", "--out="], output: "a\0b\n" },
  { args: ["--ch", "2"], output: ":\n" },
  { args: ["--f=2", "--d", ":", "--on"], output: "b\n" },
  { args: ["--b=1", "--z"], output: "a\0" },
  { args: ["--out", "--comp", "-b1,3"], output: "a--compb\n" },
  { args: ["--out", "--c", "-b1,3"], output: "a--cb\n" },
  { args: ["-b1,3", "--out", "--"], output: "a--b\n" },
]) {
  test(`cut accepts long options: ${args.join(" ")}`, async () => {
    const result = await run("cut", args, { commands, stdin: "a:b:c", env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, output);
    assert.equal(result.stderr, "");
  });
}

for (const option of ["--c", "--c=2", "--o", "--o=/"]) {
  test(`cut rejects ambiguous option ${option}`, async () => {
    const result = await run("cut", [option, "-b2"], { commands, stdin: "a:b:c", env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ambiguous/);
  });
}

for (const args of [["-b1", "--out"], ["-b1", "--comp=yes"], ["--unknown", "-b1"]]) {
  test(`cut rejects invalid long options: ${args.join(" ")}`, async () => {
    const result = await run("cut", args, { commands, stdin: "a:b:c" });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  });
}

test("cut preserves option-looking filenames after --", async () => {
  const fs = await fixture({ "--comp": "a:b:c", "--c": "x:y:z" });
  const result = await run("cut", ["--b=1", "--", "--comp", "--c"], { commands, fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "a\nx\n");
  assert.equal(result.stderr, "");
});

for (const option of ["--he", "--ver"]) {
  test(`cut accepts information prefix ${option}`, async () => {
    const result = await run("cut", ["--out", "/", option, "--invalid"], { commands });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, option === "--he" ? /Usage: cut/ : /cut \(safe-bash/);
    assert.equal(result.stderr, "");
  });
}

test("cut abbreviations work in shell pipelines and substitutions", async () => {
  const shell = new Shell({ fs: await fixture({ input: "a:b:c" }), cwd: "/work", commands: new CommandRegistry(commands) });
  try {
    for (const source of ["cut --comp -b2 input | cut --out / -b1,3", "result=$(cut --comp -b2 input | cut --out / -b1,3); cut --b=1- <<< \"$result\""]) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "a/:\n");
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});
