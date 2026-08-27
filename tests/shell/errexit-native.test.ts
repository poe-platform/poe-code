import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { errexitCases } from "./errexit-cases.js";
import { virtualErrexit } from "./errexit-native.js";
import type { ErrexitReference } from "./errexit-native.js";

const reference = JSON.parse(await readFile(new URL("./errexit-native.json", import.meta.url), "utf8")) as ErrexitReference;
for (const row of reference.profiles[0]!.rows) test(`errexit ${row.mode}/${row.name}`, { timeout: 3000 }, async () => {
  assert.deepEqual(await virtualErrexit(errexitCases.find(fixture => fixture.name === row.name)!, row.mode), row.observation);
});
