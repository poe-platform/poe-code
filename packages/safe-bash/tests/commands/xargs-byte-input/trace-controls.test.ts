import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

for (const hex of ["010d1b7f", "c280c285c29f", "090a275c", "c3a9e4b8ad"]) test(`raw verbose control/Unicode replay: ${hex}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec("xargs -0 -t printf '%s\\0'", { stdin: Buffer.from(`${hex}00`, "hex") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), `${hex}00`);
    const replay = await shell.exec(result.stderr);
    assert.equal(replay.exitCode, 0, replay.stderr);
    assert.deepEqual(replay.stdoutBytes, result.stdoutBytes);
  } finally { await shell.dispose(); }
});
