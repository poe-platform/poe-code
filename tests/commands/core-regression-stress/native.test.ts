import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chunks, execute, fixture, snapshot } from "./helpers.js";
import { vectors } from "./vectors.js";

const native = JSON.parse(readFileSync(new URL("./native.json", import.meta.url), "utf8")) as {
  observations: { name: string; vectorSha256: string; stdout: string; stderr: string; exitCode: number; files: Record<string, string> }[];
};
for (const vector of vectors) test(`independent native ${vector.name}`, async () => {
  const expected = native.observations.find(row => row.name === vector.name)!;
  assert.ok(expected);
  assert.equal(createHash("sha256").update(JSON.stringify(vector)).digest("hex"), expected.vectorSha256);
  for (const width of [1, 3, 65536]) {
    const fs = await fixture(vector);
    const result = await execute(vector.command, vector.args, { fs, env: { LC_ALL: "C", ...vector.env }, stdin: chunks(Buffer.from(vector.stdin ?? "", "base64"), width) });
    assert.deepEqual(await snapshot(fs), expected.files, `filesystem effects, chunk=${width}`);
    assert.equal(result.exitCode, expected.exitCode, result.stderr.toString());
    assert.equal(result.stdout.toString("base64"), expected.stdout, `stdout, chunk=${width}`);
    assert.equal(result.stderr.length === 0, expected.stderr.length === 0);
  }
});
