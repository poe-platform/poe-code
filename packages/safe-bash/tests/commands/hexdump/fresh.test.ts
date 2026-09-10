import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";
import { freshFixtures, freshCases } from "./fresh-fixtures.js";

for (const fixture of freshCases) test(`fresh BSD oracle: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(freshFixtures)) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
  await fs.mkdir("/directory");
  const result = await run([...fixture.args], Buffer.from(fixture.inputHex, "hex"), {}, { fs, env: { LC_ALL: "C", ...fixture.env } }, fixture.binary);
  assert.deepEqual(result, { exitCode: fixture.status, stdout: fixture.stdoutHex, stderr: fixture.stderrHex });
});
