import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { cases } from "./expanded-gaps-cases.js";
import { hash, virtual } from "./expanded-gaps-harness.js";
const evidence = JSON.parse(await readFile(new URL("./expanded-gaps-native.json", import.meta.url), "utf8"));
assert.equal(hash(await readFile(new URL("./expanded-gaps-cases.ts", import.meta.url))), evidence.scenariosHash);
for (const fixture of cases.filter(fixture => fixture.group === "fallback")) test(fixture.name, async () => {
  assert.deepEqual(await virtual(fixture, evidence.cwd, evidence.environment), evidence.results[0].rows.find((row: { name: string; group: string }) => row.name === fixture.name && row.group === fixture.group).actual);
});
