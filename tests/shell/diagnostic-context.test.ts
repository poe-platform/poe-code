import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { diagnosticContextCases } from "./diagnostic-context-cases.js";
import { virtualContext } from "./diagnostic-context-native.js";
import type { ContextReference } from "./diagnostic-context-native.js";

const reference = JSON.parse(await readFile(new URL("./diagnostic-context-native.json", import.meta.url), "utf8")) as ContextReference;
for (const fixture of diagnosticContextCases) test(`NUL ${fixture.group}: ${fixture.name}`, { timeout: 3000 }, async () => {
  assert.deepEqual(await virtualContext(fixture), reference.profiles[0]!.rows.find(row => row.name === fixture.name)!.expected);
});
