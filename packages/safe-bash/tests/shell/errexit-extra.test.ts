import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { virtualErrexit } from "./errexit-native.js";
import type { ErrexitReference } from "./errexit-native.js";
import type { ErrexitCase } from "./errexit-cases.js";

const reference = JSON.parse(await readFile(new URL("./errexit-extra-native.json", import.meta.url), "utf8")) as ErrexitReference & { fixtures: ErrexitCase[] };
for (const row of reference.profiles[0]!.rows) test(`errexit adjacent ${row.mode}/${row.name}`, async () => {
  assert.deepEqual(await virtualErrexit(reference.fixtures.find(fixture => fixture.name === row.name)!, row.mode), row.observation);
});
