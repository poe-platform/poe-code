import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Shell, agentCommands, createMemoryFileSystem } from "../../../dist/index.js";
import { archiveCommands, createArchiveCommands, createTarCommand, DEFAULT_ARCHIVE_LIMITS } from "../../../dist/commands/archive/index.js";

assert.equal(typeof archiveCommands, "function");
assert.equal(createTarCommand().name, "tar");
assert.deepEqual(createArchiveCommands().map(command => command.name), ["tar"]);
assert.equal(DEFAULT_ARCHIVE_LIMITS.chunkSize, 65536);
const metadata = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
const fs = createMemoryFileSystem();
await fs.mkdir("/input"); await fs.mkdir("/output");
const payload = Uint8Array.of(0, 255, 128, 10);
await fs.writeFile("/input/data", payload);
const shell = new Shell({ fs }).use(agentCommands());
try {
  const result = await shell.exec("tar czf - -C /input . | tar xzf - -C /output");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await fs.readFile("/output/data"), payload);
  const listed = await shell.exec("tar cf - -C /input data | tar tf -");
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(listed.stdout, "data\n");
} finally { await shell.dispose(); }
console.log("Built archive checks: 4/4 (API, zero runtime dependencies, gzip pipeline, listing pipeline)");
