import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { virtualObservation } from "./invocation-closure-native.js";
import type { CapturedReference } from "./invocation-closure-native.js";
import { evalCases } from "./source-dot-eval-cases.js";
import { fixtureCase } from "./source-dot-eval-native.js";

const reference = JSON.parse(await readFile(new URL("./source-dot-eval-eval-native.json", import.meta.url), "utf8")) as CapturedReference;
for (const entry of reference.profiles[0]!.observations) test(`eval ${entry.mode}/${entry.name}`, async () => {
  assert.deepEqual(await virtualObservation(fixtureCase(evalCases.find(fixture => fixture.name === entry.name)!), entry.mode, entry.cwd), entry.observation);
});
