import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { virtualObservation } from "./invocation-closure-native.js";
import type { capture } from "./invocation-closure-native.js";
import { sourceCases } from "./source-dot-eval-cases.js";
import { fixtureCase } from "./source-dot-eval-native.js";

const reference = JSON.parse(await readFile(new URL("./source-dot-eval-source-native.json", import.meta.url), "utf8")) as Awaited<ReturnType<typeof capture>>;
for (const entry of reference.profiles[0]!.observations) test(`source ${entry.mode}/${entry.name}`, async () => {
  assert.deepEqual(await virtualObservation(fixtureCase(sourceCases.find(fixture => fixture.name === entry.name)!), entry.mode, entry.cwd), entry.observation);
});
