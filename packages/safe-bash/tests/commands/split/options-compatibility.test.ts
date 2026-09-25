import assert from "node:assert/strict";
import { test } from "node:test";
import { files, run } from "./helpers.js";

const hex = (text: string) => Buffer.from(text).toString("hex");

test("hexadecimal suffix starts use hexadecimal digits and radix", async () => {
  for (const [start, first, second] of [["10", "10", "11"], ["1A", "1a", "1b"], ["000f", "0f", "10"]]) {
    const result = await run(["-l1", `--hex-suffixes=${start}`], "a\nb\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { [`x${first}`]: hex("a\n"), [`x${second}`]: hex("b\n") });
  }
});

test("legacy numeric line option splits records", async () => {
  const result = await run(["-2"], "1\n2\n3\n4\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), { xaa: hex("1\n2\n"), xab: hex("3\n4\n") });
});

test("chunk modes preserve lines, distribute records, and select stdout", async () => {
  for (const [mode, outputs] of [
    ["l/2", ["abc\nd\n", "ef\n"]],
    ["r/2", ["abc\nef\n", "d\n"]],
    ["2", ["abc\nd", "\nef\n"]],
  ] as const) {
    const result = await run(["-n", mode], "abc\nd\nef\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { xaa: hex(outputs[0]), xab: hex(outputs[1]) });
    const selected = await run(["-n", mode === "2" ? "2/2" : `${mode[0]}/2/2`], "abc\nd\nef\n");
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.equal(selected.stdout, outputs[1]);
    assert.deepEqual(await files(selected.fs), {});
  }
});

test("invalid suffix and chunk specifications fail before writing", async () => {
  for (const args of [["--hex-suffixes=1g"], ["--numeric-suffixes=1a"], ["-n0/2"], ["-nl/3/2"], ["-nr/0"], ["-n1/2/3"]]) {
    const result = await run(args, "abc");
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await files(result.fs), {});
  }
});

test("line chunks skip empty middle chunks without dropping later records", async () => {
  const result = await run(["-n", "l/4", "-e"], "123456789\na\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), { xaa: hex("123456789\n"), xab: hex("a\n") });
});

test("round-robin honors custom separators and unterminated records", async () => {
  const result = await run(["-n", "r/2", "-t:"], "a:bb:ccc");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), { xaa: hex("a:ccc"), xab: hex("bb:") });
});

test("selected chunks consume output budget but no file quota", async () => {
  const result = await run(["-n", "r/2/3"], "a\nb\nc\nd\ne\n", { limits: { maxFiles: 1 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "b\ne\n");
  assert.deepEqual(await files(result.fs), {});
  const capped = await run(["-n", "r/2/3"], "a\nb\nc\nd\ne\n", { limits: { maxOutputBytes: 3 } });
  assert.equal(capped.exitCode, 1);
  assert.ok(capped.stderr.includes("output"));
  assert.deepEqual(await files(capped.fs), {});
});

test("mixed -d and -x suffix options format start values in the final radix without undefined digits", async () => {
  const hexToDec = await run(["-l1", "--hex-suffixes=f", "-d"], "a\nb\n");
  assert.equal(hexToDec.exitCode, 0, hexToDec.stderr);
  assert.deepEqual(await files(hexToDec.fs), { x15: hex("a\n"), x16: hex("b\n") });

  const decToHex = await run(["-l1", "--numeric-suffixes=15", "-x"], "a\nb\n");
  assert.equal(decToHex.exitCode, 0, decToHex.stderr);
  assert.deepEqual(await files(decToHex.fs), { x0f: hex("a\n"), x10: hex("b\n") });

  const dec100ToHex = await run(["-l1", "--numeric-suffixes=100", "-x"], "a\nb\n");
  assert.equal(dec100ToHex.exitCode, 0, dec100ToHex.stderr);
  assert.deepEqual(await files(dec100ToHex.fs), { x64: hex("a\n"), x65: hex("b\n") });

  const overflowAfterDec = await run(["-l1", "--hex-suffixes=ff", "-d"], "a\nb\n");
  assert.equal(overflowAfterDec.exitCode, 1);
  assert.match(overflowAfterDec.stderr, /too large for the suffix length/);
  assert.deepEqual(await files(overflowAfterDec.fs), {});
});

test("verbose and unbuffered options emit file creation diagnostics and accept flags", async () => {
  const verbose = await run(["--verbose", "-u", "--unbuffered", "-l", "2"], "a\nb\nc\n");
  assert.equal(verbose.exitCode, 0, verbose.stderr);
  assert.equal(verbose.stdout, "creating file 'xaa'\ncreating file 'xab'\n");
  assert.deepEqual(await files(verbose.fs), { xaa: hex("a\nb\n"), xab: hex("c\n") });

  for (const flag of ["--verbose=yes", "--unbuffered=yes"]) {
    const rejected = await run([flag], "a\n");
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr, /doesn't allow an argument/);
    assert.deepEqual(await files(rejected.fs), {});
  }
});
