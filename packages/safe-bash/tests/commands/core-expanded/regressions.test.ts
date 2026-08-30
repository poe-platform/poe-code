import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chunks, fixture, run } from "../helpers.js";
import { files } from "./vectors.js";

const native = JSON.parse(await readFile(new URL("native.json", import.meta.url), "utf8")) as {
  wc: { name: string; args: string[]; stdin: string; env: Record<string, string>; stdout: string; stderr: string; exitCode: number }[];
  realpath: { args: string[]; stdout: string; stderr: string; exitCode: number }[];
};

for (const vector of native.wc) test(`GNU9.7 frozen wc: ${vector.name}`, async () => {
  for (const width of [1, 2, 17]) {
    const result = await run("wc", vector.args, { fs: await fixture(files), stdin: chunks(vector.stdin, width), env: vector.env });
    assert.equal(result.stdout, vector.stdout); assert.equal(result.stderr, vector.stderr); assert.equal(result.exitCode, vector.exitCode);
  }
});

for (const vector of native.realpath) test(`GNU9.7 frozen realpath: ${vector.args.join(" ")}`, async () => {
  const fs = await fixture(files); await fs.symlink("tree", "/work/alias");
  const result = await run("realpath", vector.args, { fs });
  assert.equal(result.stdout, vector.stdout); assert.equal(result.stderr, vector.stderr); assert.equal(result.exitCode, vector.exitCode);
});

test("relative paths preserve filesystem errors, literals and cancellation", async () => {
  const fs = await fixture(files);
  assert.notEqual((await run("realpath", ["-e", "--relative-to=absent", "tree/file"], { fs })).exitCode, 0);
  assert.notEqual((await run("realpath", ["--relative-to"], { fs })).exitCode, 0);
  const controller = new AbortController(); controller.abort(new Error("stop"));
  await assert.rejects(run("realpath", ["--relative-to=.", "tree/file"], { fs, signal: controller.signal }), /stop/);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/tree/file")), "payload");
});

test("C wc treats arbitrary octets as characters without decoding", async () => {
  const input = Uint8Array.from({ length: 256 }, (_, index) => index);
  const result = await run("wc", ["-m"], { stdin: chunks(input, 1), env: { LC_ALL: "C" } });
  assert.equal(result.stdout, "256\n");
});

test("env preserves exact bindings with the pinned gnulib prepend-new profile", async () => {
  const parent = { OUTER: "secret" };
  for (const assignments of [["A=1", "B=2"], ["B=2", "A=1"]]) {
    const result = await run("env", ["-i", ...assignments], { env: parent });
    assert.equal(result.stdout, [...assignments].reverse().join("\n") + "\n");
    assert.deepEqual(Object.fromEntries(result.stdout.trimEnd().split("\n").map(value => value.split("="))), { A: "1", B: "2" });
  }
  assert.deepEqual(parent, { OUTER: "secret" });
});
