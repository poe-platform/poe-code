import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";
import { fixtures, cases } from "./fixtures.js";

for (const fixture of cases) test(`glibc 2.31-0ubuntu9.18: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(fixtures)) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
  await fs.mkdir("/directory");
  const result = await run([...fixture.args], Buffer.from(fixture.inputHex, "hex"), {}, { fs, env: { LC_ALL: fixture.locale } });
  assert.deepEqual(result, { exitCode: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.portableStderrHex });
});
