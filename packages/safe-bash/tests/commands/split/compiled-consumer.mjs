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
  await fs.mkdir("/out");
  await fs.symlink("/out", "/prefix");
  await fs.symlink("target", "/out/pieceaa");
  const dangling = await shell.exec("printf abc | split -b2 - prefix/piece; cat /out/target prefix/pieceab");
  assert.equal(dangling.exitCode, 0, dangling.stderr);
  assert.equal(dangling.stderr, "");
  assert.equal(dangling.stdout, "abc");
  assert.equal(await fs.readlink("/out/pieceaa"), "target");
  assert.equal(Buffer.from(await fs.readFile("/out/target")).toString(), "ab");
  console.log(JSON.stringify({ danglingCompiledConsumer: true, exitCode: dangling.exitCode, stdout: dangling.stdout, link: await fs.readlink("/out/pieceaa"), target: "/out/target" }));
  console.log(JSON.stringify({ compiledModule: "tests/commands/split/.build/src/commands/split/index.js", factory: "createSplitCommands", plugin: "splitCommands", files: (await fs.readdir("/")).map(entry => entry.name).sort(), stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), exitCode: result.exitCode, packageSubpathExport: false }));
} finally { await shell.dispose(); }
