import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { seed, shellRun } from "./helpers.js";

interface Row { args: string[]; stdout: string; stderr: string; exitCode: number }
interface Fixtures {
  provenance: { version: string; binarySha256: string; archiveSha256: string };
  exact: Row[];
  semantic: Row[];
  divergent: Row[];
}
const fixtures = JSON.parse(await readFile(new URL("./native-fixtures.json", import.meta.url), "utf8")) as Fixtures;

for (const row of fixtures.exact) test(`frozen tree 2.2.1 C/ASCII exact: ${row.args.join(" ") || "default"}`, async () => {
  const fs = createMemoryFileSystem();
  await seed(fs);
  const result = await shellRun(fs, row.args);
  assert.equal(result.exitCode, row.exitCode);
  assert.equal(result.stdout, row.stdout);
  assert.equal(result.stderr, row.stderr);
});

for (const row of fixtures.semantic) test(`frozen tree 2.2.1 JSON semantic: ${row.args.join(" ")}`, async () => {
  const fs = createMemoryFileSystem();
  await seed(fs);
  const result = await shellRun(fs, row.args);
  assert.equal(result.exitCode, row.exitCode);
  assert.deepEqual(JSON.parse(result.stdout), JSON.parse(row.stdout));
  assert.equal(result.stderr, row.stderr);
});

test("original native divergence rows remain explicit, not parity passes", () => {
  assert.equal(fixtures.divergent.length, 6);
  assert.match(fixtures.divergent[0]!.stdout, /link -> dir {2}\[recursive, not followed\]/u);
  assert.throws(() => JSON.parse(fixtures.divergent[4]!.stdout), SyntaxError);
  assert.match(fixtures.provenance.version, /^tree v2\.2\.1 /u);
});
