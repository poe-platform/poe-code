import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { evalSyncSplit } from "./index.js";
import { files, run } from "./test-helpers.js";

const hex = (text: string) => Buffer.from(text).toString("hex");

test("conflicting separators fail without changing files", async () => {
  for (const args of [
    ["-t", ":", "-t", ","],
    ["--separator=:", "--separator", ","],
    ["-t:", "--separator=,"],
    ["--separator=:", "-t,"],
    ["-t", "\n", "-t:"],
    ["-t", "\\0", "-t:"],
  ]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in", Buffer.from("a:b,c"));
    await fs.writeFile("/xaa", Buffer.from("OLD"));
    const result = await run([...args, "-l1", "in"], "", {}, { fs });
    assert.equal(result.exitCode, 1, JSON.stringify(args));
    assert.equal(result.stderr, "split: multiple separator characters specified\n");
    assert.deepEqual(await files(fs), { in: hex("a:b,c"), xaa: hex("OLD") });
  }
});

test("identical separators remain valid across short and long options", async () => {
  for (const separator of [":", "\n", "\\0"]) {
    const byte = separator === "\\0" ? "\0" : separator;
    const result = await run(["-t", separator, `--separator=${separator}`, "-l1"], `a${byte}b`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { xaa: hex(`a${byte}`), xab: hex("b") });
  }
});

test("hexadecimal suffix starts use hexadecimal digits and radix", async () => {
  for (const [start, first, second] of [["10", "10", "11"], ["a", "0a", "0b"], ["1a", "1a", "1b"], ["000f", "0f", "10"]]) {
    const result = await run(["-l1", `--hex-suffixes=${start}`], "a\nb\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { [`x${first}`]: hex("a\n"), [`x${second}`]: hex("b\n") });
  }
});

test("uppercase hexadecimal suffix starts fail before creating or overwriting files", async () => {
  for (const start of ["A", "B", "C", "D", "E", "F", "1A", "aF"]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in", Buffer.from("abc"));
    await fs.writeFile("/x0a", Buffer.from("keep"));
    const result = await run([`--hex-suffixes=${start}`, "-b1", "in"], "", {}, { fs });
    assert.equal(result.exitCode, 1, start);
    assert.ok(result.stderr.includes("invalid start value"), result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(await files(result.fs), { in: hex("abc"), x0a: hex("keep") });

    const writes: string[] = [];
    assert.equal(evalSyncSplit(Buffer.from("abc"), [`--hex-suffixes=${start}`, "-b1"], undefined, path => {
      writes.push(path);
      return true;
    }), undefined);
    assert.deepEqual(writes, []);
  }
});

test("legacy numeric line option splits records", async () => {
  const result = await run(["-2"], "1\n2\n3\n4\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), { xaa: hex("1\n2\n"), xab: hex("3\n4\n") });
});

test("repeated legacy counts use the last short-option group", async () => {
  for (const args of [["-2", "-1"], ["-0", "-1"]]) {
    const result = await run(args, "a\nb\nc\nd\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { xaa: hex("a\n"), xab: hex("b\n"), xac: hex("c\n"), xad: hex("d\n") });
  }
  const result = await run(["-1", "-2"], "a\nb\nc\nd\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await files(result.fs), { xaa: hex("a\nb\n"), xab: hex("c\nd\n") });
});

test("legacy digits combine within short-option groups", async () => {
  for (const args of [["-d1"], ["-1d"], ["-2", "-d1"]]) {
    const result = await run(args, "a\nb\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { x00: hex("a\n"), x01: hex("b\n") });
  }
  for (const arg of ["-12d", "-1d2"]) {
    const result = await run([arg], "a\n".repeat(13));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(result.fs), { x00: hex("a\n".repeat(12)), x01: hex("a\n") });
  }
});

test("legacy counts still reject modern split modes and invalid final counts before writing", async () => {
  for (const args of [["-l1", "-l2"], ["-1", "-l2"], ["-l2", "-1"], ["-b2", "-1"], ["-1", "-n2"]]) {
    const result = await run(args, "a\nb\n");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("cannot split in more than one way"));
    assert.deepEqual(await files(result.fs), {});
  }
  for (const args of [["-1", "-0"], ["-d0"], ["-9007199254740992"]]) {
    const result = await run(args, "a\nb\n");
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await files(result.fs), {});
  }
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
