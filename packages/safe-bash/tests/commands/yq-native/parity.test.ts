import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { cases } from "./cases.js";
import { native, nativeOptions, run } from "./helpers.js";

const captured = JSON.parse(await readFile(new URL("./ORACLE_INITIAL.json", import.meta.url), "utf8")) as {
  help: { status: number; stdout: string; stderr: string };
  results: { status: number; stdout: string; stderr: string }[];
};

test("primary help matches captured pinned bytes", async () => {
  assert.deepEqual(await run(["--help"]), captured.help);
});

for (const [index, entry] of cases.entries()) test(`captured native case ${index}: ${JSON.stringify(entry.args)}`, async () => {
  assert.deepEqual(await run(entry.args, entry.input), captured.results[index]);
});

test("live explicit pinned oracle agrees with preserved capture", nativeOptions, async () => {
  assert.deepEqual(await native(["--help"]), captured.help);
  for (const [index, entry] of cases.entries()) assert.deepEqual(await native(entry.args, entry.input), captured.results[index]);
});
