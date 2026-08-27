import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

for (const [args, expected, exitCode] of [
  [[], "A=one\nEMPTY=\nUNICODE=雪\nline\n", 0],
  [["A", "EMPTY", "UNICODE"], "one\n\n雪\nline\n", 0],
  [["missing", "A", "missing", "EMPTY"], "one\n\n", 1],
  [["A", "A"], "one\none\n", 0],
  [["--null", "EMPTY", "UNICODE"], "\0雪\nline\0", 0],
  [["-00", "A"], "one\0", 0],
  [["A", "-0"], "one\n", 1],
  [["A=one"], "", 1],
  [["--", "-0"], "", 1],
] as const) {
  test(`printenv own dictionary ${JSON.stringify(args)}`, async () => {
    const actual = await run("printenv", args, {}, { env: { A: "one", EMPTY: "", UNICODE: "雪\nline" } });
    assert.equal(actual.stdout, expected);
    assert.equal(actual.exitCode, exitCode);
    assert.equal(actual.stderr, "");
  });
}

test("printenv own prototype-shaped and nonenumerable names never consult inherited or host environment", async () => {
  const env = Object.create({ inherited: "secret", PATH: "inherited path" }) as Record<string, string>;
  for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) Object.defineProperty(env, name, { value: `own:${name}`, enumerable: true });
  Object.defineProperty(env, "hidden", { value: "nonenumerable" });
  const result = await run("printenv", ["__proto__", "constructor", "toString", "hasOwnProperty", "hidden", "PATH", "inherited"], {}, { env });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "own:__proto__\nown:constructor\nown:toString\nown:hasOwnProperty\nnonenumerable\n");
  assert.equal((await run("printenv", [], {}, { env })).stdout,
    "__proto__=own:__proto__\nconstructor=own:constructor\ntoString=own:toString\nhasOwnProperty=own:hasOwnProperty\nhidden=nonenumerable\n");
  assert.equal(Object.getPrototypeOf(env).inherited, "secret");
  const absent = await run("printenv", ["PATH"]);
  assert.equal(absent.exitCode, 1); assert.equal(absent.stdout, ""); assert.equal(absent.stderr, "");
});

test("printenv empty dictionary and missing name do not acquire stdin or write output", async () => {
  let reads = 0, writes = 0;
  const stdin = (async function* () { reads++; yield Buffer.from("private"); })();
  const overrides = { stdin, stdout: { async write() { writes++; } } };
  assert.equal((await run("printenv", [], {}, overrides)).exitCode, 0);
  assert.equal((await run("printenv", ["missing"], {}, overrides)).exitCode, 1);
  assert.equal(reads, 0); assert.equal(writes, 0);
});

for (const argument of ["-i", "-u", "--null=yes", "--invalid"]) {
  test(`printenv invalid option ${argument} is status2 without stdout`, async () => {
    const result = await run("printenv", [argument]);
    assert.equal(result.exitCode, 2); assert.equal(result.stdout, ""); assert.match(result.stderr, /invalid option/);
  });
}

test("printenv bounds output before effects and propagates sink rejection unchanged", async () => {
  let writes = 0;
  await assert.rejects(run("printenv", [], { limits: { maxOutputBytes: 3 } }, { env: { A: "long" }, stdout: { async write() { writes++; } } }), { code: "EFBIG" });
  assert.equal(writes, 0);
  await assert.rejects(run("printenv", [], { limits: { maxEnvironmentEntries: 1 } }, { env: { A: "", B: "" } }), { code: "EFBIG" });
  const error = new Error("sink quota");
  await assert.rejects(run("printenv", ["A"], {}, { env: { A: "a" }, stdout: { async write() { throw error; } } }), value => value === error);
});
