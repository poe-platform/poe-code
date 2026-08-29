import assert from "node:assert/strict";
import * as api from "virtual-bash";
let releases = 0;
globalThis.__redirectReleaseObserver = () => { releases++; };
const memory = new api.MemoryFileSystem(), shell = new api.Shell({ fs: memory }).use(api.agentCommands());
const row = { id: "instrumented-one-file-reference-release", pass: false, created: 1 };
try {
  const result = await shell.exec("{ printf O; printf E >&2; } &>out");
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(releases, 1);
  assert.equal(Buffer.from(await memory.readFile("/out")).toString(), "OE"); row.pass = true;
} catch (error) { row.error = String(error.stack ?? error); }
finally { await shell.dispose(); row.disposed = 1; delete globalThis.__redirectReleaseObserver; }
console.log(JSON.stringify(row)); console.log(JSON.stringify({ summary: { cases: 1, pass: Number(row.pass), fail: Number(!row.pass) } }));
process.exitCode = row.pass ? 0 : 1;
