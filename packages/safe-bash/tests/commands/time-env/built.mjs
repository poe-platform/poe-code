import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const load = path => import(pathToFileURL(resolve("dist", path)).href);
const { createTimeEnvCommands, timeEnvCommands } = await load("commands/time-env/index.js");
const { Shell } = await load("shell/index.js");
const { createMemoryFileSystem } = await load("fs/memory/index.js");
const { standardCommands } = await load("commands/index.js");
const { createAgentCommands } = await load("plugins/index.js");
assert.deepEqual(createTimeEnvCommands().map(entry => entry.name), ["date", "sleep", "printenv"]);
assert.equal(createAgentCommands().some(entry => ["date", "sleep", "printenv"].includes(entry.name)), false);
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(standardCommands()).use(timeEnvCommands({ clock: () => 1709210096123 }));
try {
  const result = await shell.exec("date -u +%FT%T.%3NZ > stamp; env -i A=hello printenv A | tr a-z A-Z; sleep .001; cat stamp");
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
  assert.equal(result.stdout, "HELLO\n2024-02-29T12:34:56.123Z\n");
  assert.equal(Buffer.from(await fs.readFile("/stamp")).toString(), "2024-02-29T12:34:56.123Z\n");
  console.log(JSON.stringify({ compiledLeafImports: true, defaultRegistryUnchanged: true, defaultCommandCount: createAgentCommands().length, stdout: result.stdout, exactFileBytes: true }));
} finally { await shell.dispose(); }
