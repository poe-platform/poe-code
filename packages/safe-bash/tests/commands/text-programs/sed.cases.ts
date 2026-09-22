import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { byteChunks, makeFileSystem, runVirtual } from "./helpers.js";

for (const [args, expected] of [
  [["--quiet", "p", "input"], "a\n"],
  [["--quiet", "", "input"], ""],
  [["--regexp-extended", "s/(a)/X/", "input"], "X\n"],
  [["--quiet", "--regexp-extended", "-e", "s/(a)/X/p", "input"], "X\n"],
  [["-f", "program", "--regexp-extended", "--quiet", "input"], "X\n"],
] as const) {
  test(`sed long aliases: ${args.join(" ")}`, async () => {
    const files = { input: "a\n", program: "s/(a)/X/p" };
    const result = await runVirtual("sed", { args, files });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.deepEqual(result.stdout, Buffer.from(expected));
    assert.deepEqual(result.files, { input: Buffer.from(files.input), program: Buffer.from(files.program) });
  });
}

test("sed long aliases preserve NUL records and non-UTF-8 bytes in shell pipelines", async () => {
  const fs = await makeFileSystem({ input: Uint8Array.of(0xff, 0x61, 0, 0x62, 0) });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("cat input | sed --quiet --regexp-extended --null-data 's/(a)/X/p' > output");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/work/output"), Uint8Array.of(0xff, 0x58, 0));
});

test("sed treats long aliases after -- as filenames", async () => {
  const result = await runVirtual("sed", {
    args: ["-e", "p", "--", "--quiet", "--regexp-extended"],
    files: { "--quiet": "a\n", "--regexp-extended": "b\n" },
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  assert.deepEqual(result.stdout, Buffer.from("a\na\nb\nb\n"));
});

for (const option of ["--quiet=yes", "--regexp-extended=yes"]) {
  test(`sed rejects an argument on the flag ${option}`, async () => {
    const result = await runVirtual("sed", { args: [option, "p"], stdin: "a\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), `sed: unsupported option '${option}'\n`);
    assert.equal(result.stdout.length, 0);
  });
}

for (const [replacement, expected] of [
  [String.raw`\n`, "\n"],
  [String.raw`\t`, "\t"],
  [String.raw`\,`, ","],
  [String.raw`\;`, ";"],
  [String.raw`\\n`, String.raw`\n`],
  [String.raw`\\`, "\\"],
  ["<&>", "<x>"],
  [String.raw`\&`, "&"],
  [String.raw`\\&`, "\\x"],
  [String.raw`\\\&`, "\\&"],
  [String.raw`\1`, "x"],
] as const) {
  test(`sed retains replacement semantics for ${JSON.stringify(replacement)}`, async () => {
    const result = await runVirtual("sed", { args: ["-E", `s/(x)/${replacement}/g`], stdin: "xx\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.deepEqual(result.stdout, Buffer.from(`${expected}${expected}\n`));
  });
}

test("sed rejects unsupported or malformed programs before stdout, input, backup or file effects", async () => {
  for (const program of ["p;s/a/b/e", "p;w", "p;{", "p;b missing", "p;s/(/x/", "p;s/a/\\9/"]) {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("a\n"); })();
    const result = await runVirtual("sed", { args: ["-E", "-i.bak", program, "input"], files: { input: "a\n" } }, {}, source);
    assert.notEqual(result.exitCode, 0, program);
    assert.equal(result.stdout.length, 0, program);
    assert.equal(consumed, false, program);
    assert.deepEqual(result.files, { input: Buffer.from("a\n") }, program);
  }
});

test("sed branch and regex work are budgeted and failed in-place execution preserves originals", async () => {
  const loop = await runVirtual("sed", { args: ["-i.bak", ":again\nb again", "input"], files: { input: "a\n" } }, { maxSteps: 50 });
  assert.equal(loop.exitCode, 2);
  assert.match(loop.stderr.toString(), /step limit/u);
  assert.deepEqual(loop.files, { input: Buffer.from("a\n") });
  const regex = await runVirtual("sed", { args: ["-E", "s/(a+)+b/X/"], stdin: "a".repeat(1000) }, { maxSteps: 2000 });
  assert.equal(regex.exitCode, 2);
  assert.match(regex.stderr.toString(), /step limit/u);
});

test("sed accepts one-byte input chunks and composes with the virtual shell", async () => {
  const streamed = await runVirtual("sed", { args: ["s/pear/apple/g"], stdin: "pear\npear" }, {}, byteChunks("pear\npear"));
  assert.equal(streamed.stdout.toString(), "apple\napple");
  const fs = await makeFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("printf 'keep:pear\\nskip:no\\nkeep:apple\\n' | sed -n '/^keep:/{s/^keep://;p;}' | sort | tee result");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "apple\npear\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/result")), result.stdout);
});
