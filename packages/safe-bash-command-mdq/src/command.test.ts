import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import { mdq } from "./index.js";
import fixtures from "./oracle-fixtures.json" with { type: "json" };
import renderFixtures from "./render-oracle-fixtures.json" with { type: "json" };

const encoder = new TextEncoder();
for (const fixture of [...fixtures, ...renderFixtures]) test(`mdq v0.10.0: ${fixture.id}`, async () => {
  const fs = createMemoryFileSystem();
  for (const [name, text] of Object.entries(fixture.files)) {
    assert.equal(typeof text, "string");
    await fs.writeFile("/" + name, encoder.encode(text as string));
  }
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await mdq({
    command: "mdq", args: fixture.argv, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(encoder.encode(fixture.stdin)),
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }
  });
  assert.equal(result.exitCode, fixture.exitCode);
  const out = Buffer.concat(stdout).toString(), err = Buffer.concat(stderr).toString();
  // Upstream serializes its reference maps with randomized hash-map ordering.
  if (fixture.argv.includes("json") && out && fixture.stdout) assert.deepEqual(JSON.parse(out), JSON.parse(fixture.stdout));
  else assert.equal(out, fixture.stdout);
  assert.equal(err, fixture.stderr);
});
