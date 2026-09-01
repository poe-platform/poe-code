import assert from "node:assert/strict";
import test from "node:test";
import { shell, type NativeCase } from "./helpers.js";

export const revCases: readonly NativeCase[] = [
  { args: [], input: "abc\n\nlast" }, { args: [], input: "" },
  { args: [], input: Buffer.from([97, 0, 98, 255, 10]) },
  { args: [], input: "é🙂\n", locale: "C" }, { args: [], input: "é🙂\n", locale: "POSIX" },
  { args: [], input: Buffer.from([97, 255, 98, 10]), locale: "" },
  { args: [], input: "é🙂\n", locale: "en_US.UTF-8" },
  { args: [], input: "a\u0301🙂\n\ufeffx\n", locale: "en_US.UTF-8" },
  { args: [], input: Buffer.from([97, 0, 98, 10]), locale: "en_US.UTF-8" },
  { args: [], input: Buffer.from([97, 255, 98, 10, 99, 10]), locale: "en_US.UTF-8", failure: true },
  { args: [], input: Buffer.from([255, 10]), locale: "en_US.UTF-8", failure: true },
  { args: [], input: Buffer.from([97, 195]), locale: "en_US.UTF-8", failure: true },
  { args: [], input: Buffer.from([97, 195, 10]), locale: "en_US.UTF-8", failure: true },
  { args: [], input: Buffer.from([195, 169, 255, 10]), locale: "en_US.UTF-8", failure: true },
  { args: ["--"], input: "ab" }, { args: ["-x"], failure: true }, { args: ["-"], failure: true },
];

test("rev guest locale precedence, no ambient host fallback", async () => {
  for (const env of [{ LANG: "en_US.UTF-8", LC_CTYPE: "C" }, { LANG: "C", LC_CTYPE: "en_US.UTF-8", LC_ALL: "C" }, {}]) {
    const instance = shell({}, env);
    const result = await instance.exec("rev", { stdin: Buffer.from([97, 255, 98, 10]) });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdoutBytes, new Uint8Array([98, 255, 97, 10]));
    await instance.dispose();
  }
});

test("rev rejects malformed current file then continues next operand", async () => {
  const instance = shell({}, { LC_ALL: "en_US.UTF-8" });
  const result = await instance.exec("printf 'a\\377b\\nignored\\n' > /a; printf 'xy' > /b; rev /a /b");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "a\nyx\n");
  assert.match(result.stderr, /Illegal byte sequence/);
  await instance.dispose();
});

test("rev record cap does not substitute malformed bytes", async () => {
  const instance = shell({ limits: { maxRecordBytes: 3 } });
  const result = await instance.exec("rev", { stdin: "abcd" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /record limit/);
  await instance.dispose();
});
