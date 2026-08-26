import assert from "node:assert/strict";
import test from "node:test";
import { chunks, fixture, run } from "./helpers.js";

test("sort uses byte ordering, numeric keys, reverse, stable and unique modes", async () => {
  assert.equal((await run("sort", [], { stdin: chunks("z\na\na\nb") })).stdout, "a\na\nb\nz\n");
  assert.equal((await run("sort", ["-nu"], { stdin: "10\n2\n02\n-3\n0.5\n" })).stdout, "-3\n0.5\n2\n10\n");
  assert.equal((await run("sort", ["-nr"], { stdin: "2\n10\n-1\n" })).stdout, "10\n2\n-1\n");
  assert.equal((await run("sort", ["-t", ":", "-k", "2,2n", "-s"], { stdin: "b:2\na:2\nz:1\n" })).stdout, "z:1\nb:2\na:2\n");
  assert.equal((await run("sort", ["-n"], { stdin: "9007199254740993\n9007199254740992\n" })).stdout, "9007199254740992\n9007199254740993\n");
  assert.equal((await run("sort", ["-fu"], { stdin: "b\nA\na\n" })).stdout, "A\nb\n");
});

test("sort checks order, writes output safely after reading input, and handles zero records", async () => {
  assert.equal((await run("sort", ["-c"], { stdin: "a\nb\n" })).exitCode, 0);
  assert.equal((await run("sort", ["-c"], { stdin: "b\na\n" })).exitCode, 1);
  assert.equal((await run("sort", ["-cu"], { stdin: "a\na\n" })).exitCode, 1);
  assert.equal((await run("sort", ["-z"], { stdin: "b\0a\0" })).stdout, "a\0b\0");
  const fs = await fixture({ input: "b\na\n" });
  assert.equal((await run("sort", ["-o", "input", "input"], { fs })).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/input")), "a\nb\n");
  assert.equal((await run("sort", ["-k", "0"])).exitCode, 2);
});

test("uniq groups adjacent records and supports counts, repeated/unique selection and comparisons", async () => {
  const stdin = "a\na\nb\na\n";
  assert.equal((await run("uniq", [], { stdin: chunks(stdin) })).stdout, "a\nb\na\n");
  assert.equal((await run("uniq", ["-c"], { stdin })).stdout, "      2 a\n      1 b\n      1 a\n");
  assert.equal((await run("uniq", ["-d"], { stdin })).stdout, "a\n");
  assert.equal((await run("uniq", ["-u"], { stdin })).stdout, "b\na\n");
  assert.equal((await run("uniq", ["-if", "1"], { stdin: "one SAME\ntwo same\nthree other" })).stdout, "one SAME\nthree other\n");
  assert.equal((await run("uniq", ["-s", "1", "-w", "1"], { stdin: "abX\ncbY\ndz" })).stdout, "abX\ndz\n");
  assert.equal((await run("uniq", ["-z"], { stdin: "a\0a\0b\0" })).stdout, "a\0b\0");
});

test("cut supports overlapping/open ranges, complement, literal fields and UTF-8 characters", async () => {
  assert.equal((await run("cut", ["-b", "1-2,2-3,5-"], { stdin: chunks("abcdef\n") })).stdout, "abcef\n");
  assert.equal((await run("cut", ["--complement", "-b", "2-4"], { stdin: "abcdef" })).stdout, "aef\n");
  assert.equal((await run("cut", ["-c", "2"], { stdin: chunks("aéz\n") })).stdout, "é\n");
  assert.deepEqual((await run("cut", ["-b", "2"], { stdin: "aéz\n" })).stdoutBytes, Buffer.from([195, 10]));
  assert.equal((await run("cut", ["-d", ":", "-f", "2,4", "--output-delimiter=|"], { stdin: "a:b:c:d\nplain\n" })).stdout, "b|d\nplain\n");
  assert.equal((await run("cut", ["-sd", ":", "-f", "2"], { stdin: "plain\na:b" })).stdout, "b\n");
  assert.equal((await run("cut", ["-b", "3-1"])).exitCode, 2);
  assert.equal((await run("cut", ["-f", "0"])).exitCode, 2);
});
