import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";
import { fixtures, cases } from "./fixtures.js";

for (const fixture of cases) test(`BSD 11.1.2ubuntu3: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(fixtures)) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
  const result = await run([...fixture.args], Buffer.from(fixture.inputHex, "hex"), {}, { fs }, fixture.binary);
  assert.deepEqual(result, { exitCode: fixture.status, stdout: fixture.stdoutHex, stderr: fixture.stderrHex });
});
