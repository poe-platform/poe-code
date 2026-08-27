import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { virtualDiagnostic } from "./source-dot-eval-diagnostics-native.js";
import type { DiagnosticReference } from "./source-dot-eval-diagnostics-native.js";

const reference = JSON.parse(await readFile(new URL("./source-dot-eval-diagnostics-native.json", import.meta.url), "utf8")) as DiagnosticReference;
for (const row of reference.profiles[0]!.rows) test(`diagnostic ${row.mode}/${row.name}`, async () => {
  assert.deepEqual(await virtualDiagnostic(row), row.expected);
});
