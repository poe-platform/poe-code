import assert from "node:assert/strict";
import { createMemoryFileSystem, Shell, standardCommands, createSplitCommands, splitCommands } from "./.build/tests/commands/split/compiled-host.js";

assert.deepEqual(createSplitCommands().map(command => command.name), ["split"]);
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(standardCommands()).use(splitCommands({ limits: { maxFiles: 8 } }));
try {
  const result = await shell.exec("printf '\\377\\000A\\nB\\n' | split --lines=1 --additional-suffix=.bin - part; cat partaa.bin partab.bin");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff00410a420a");
  assert.equal((await fs.readdir("/")).length, 2);
  console.log(JSON.stringify({ compiledModule: "tests/commands/split/.build/src/commands/split/index.js", factory: "createSplitCommands", plugin: "splitCommands", files: (await fs.readdir("/")).map(entry => entry.name).sort(), stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), exitCode: result.exitCode, packageSubpathExport: false }));
} finally { await shell.dispose(); }
