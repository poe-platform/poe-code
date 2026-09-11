import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";
import { translitCases, translitFiles } from "./translit-fixtures.js";

for (const fixture of translitCases) test(`native C-profile transliteration: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(translitFiles)) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
  const result = await run([...fixture.args], Buffer.from(fixture.inputHex, "hex"), {}, { fs, env: fixture.env });
  assert.equal(result.exitCode, fixture.exitCode); assert.equal(result.stderrHex, fixture.stderrHex);
  if (fixture.stdoutHex !== undefined) assert.equal(result.stdoutHex, fixture.stdoutHex);
  else {
    const stdout = Buffer.from(result.stdoutHex, "hex");
    assert.equal(stdout.length, fixture.stdoutBytes);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), fixture.stdoutSha256);
  }
});
