import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { run } from "../helpers.js";

const native = JSON.parse(await readFile(new URL("native-order.json", import.meta.url), "utf8")) as {
  observations: { args: string[]; env: Record<string, string>; stdout: string; stderr: string; exitCode: number }[];
};
for (const [index, row] of native.observations.entries()) test(`pinned GNU9.7 gnulib env ordering ${index}: ${row.args.join(" ")}`, async () => {
  const parent = { ...row.env };
  const result = await run("env", row.args, { env: parent });
  assert.equal(result.stdoutBytes.toString("base64"), row.stdout);
  assert.equal(result.stderrBytes.toString("base64"), row.stderr);
  assert.equal(result.exitCode, row.exitCode);
  assert.deepEqual(parent, row.env);
});
