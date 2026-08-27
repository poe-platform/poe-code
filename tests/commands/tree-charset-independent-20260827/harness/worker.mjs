import assert from "node:assert/strict";
import { parentPort } from "node:worker_threads";
import { Shell, agentCommands, createAgentCommands, createMemoryFileSystem } from "virtual-bash";

const resolved = import.meta.resolve("virtual-bash");
const fs = createMemoryFileSystem();
await fs.writeFile("/file", new Uint8Array());
const shell = new Shell({ fs, env: {} }).use(agentCommands());
let stdout;
try { stdout = (await shell.exec("tree --noreport")).stdout; }
finally { await shell.dispose(); }
assert.ok(parentPort);
parentPort.postMessage({ count: createAgentCommands().length, stdout, resolvedInsidePackage: resolved.includes("/node_modules/virtual-bash/dist/") });
