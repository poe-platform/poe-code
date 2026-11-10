import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { fixture, run } from "./helpers.js";

test("uniq resolves unique long-option prefixes independently of arguments", async () => {
  for (const [args, expected] of [
    [["--gro"], "A x\n\nB x\n\nC y\n"],
    [["--gro=append"], "A x\n\nB x\n\nC y\n\n"],
    [["--skip-f=1"], "A x\nC y\n"],
    [["--skip-f", "1"], "A x\nC y\n"],
    [["--skip-fields=1"], "A x\nC y\n"],
    [["--skip-c=2"], "A x\nC y\n"],
    [["--check-c=0"], "A x\n"],
    [["--cou"], "      1 A x\n      1 B x\n      1 C y\n"],
    [["--all", "--skip-f=1"], "A x\nB x\n"],
    [["--all=separate", "--skip-f=1"], "A x\nB x\n"],
    [["--rep", "--skip-f=1"], "A x\n"],
    [["--uni", "--skip-f=1"], "C y\n"],
  ] as const) {
    const result = await run("uniq", args, { stdin: "A x\nB x\nC y", env: { LC_ALL: "C" }, commands: textCommands() });
    assert.equal(result.exitCode, 0, args.join(" "));
    assert.equal(result.stdout, expected, args.join(" "));
    assert.equal(result.stderr, "");
  }
});

test("uniq prefix flags preserve case folding, delimiters, and optional-argument operands", async () => {
  const folded = await run("uniq", ["--ign", "--zero"], { stdin: "A\0a\0B", commands: textCommands() });
  assert.equal(folded.exitCode, 0);
  assert.equal(folded.stdout, "A\0B\0");
  for (const [option, expected] of [["--gro", "a\na\n\nb\n"], ["--all", "a\na\n"]]) {
    const result = await run("uniq", [option!, "in"], { fs: await fixture({ in: "a\na\nb" }), commands: textCommands() });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  }
});

test("uniq rejects ambiguous and unknown prefixes without touching output", async () => {
  for (const option of ["--s=1", "--skip=1", "--unknown", "--gro="]) {
    const fs = await fixture({ in: "A x\nB x\nC y", out: "KEEP" });
    const result = await run("uniq", [option, "in", "out"], { fs, commands: textCommands() });
    assert.notEqual(result.exitCode, 0, option);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/out")), "KEEP");
  }
});

test("uniq keeps long-option prefixes literal after option parsing ends", async () => {
  for (const name of ["--gro", "--all", "--s=1"]) {
    const fs = await fixture({ [name]: "a\na\n", in: "b\nb\n" });
    const literal = await run("uniq", ["--", name], { fs, commands: textCommands() });
    assert.equal(literal.exitCode, 0);
    assert.equal(literal.stdout, "a\n");
    const posix = await run("uniq", ["in", name], { fs, env: { POSIXLY_CORRECT: "" }, commands: textCommands() });
    assert.equal(posix.exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${name}`)), "b\n");
  }
});
