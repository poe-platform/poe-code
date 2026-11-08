import assert from "node:assert/strict";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { cases, script } from "./cases.js";

for (const entry of cases) {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const calls: string[][] = [];
  const statuses: string[][] = [];
  shell.register({ name: "__array_value", execute(context) { calls.push([...context.args]); return { exitCode: 0 }; } });
  shell.register({ name: "__array_status", execute(context) { statuses.push([...context.args]); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec(script(entry));
    assert.equal(result.exitCode, 0, entry.id);
    assert.equal(result.stdout, "", entry.id);
    assert.equal(result.stderr, "", entry.id);
    assert.deepEqual(statuses, [["0"]], entry.id);
    assert.deepEqual(calls, [entry.expected], entry.id);
    process.stdout.write(`S06_PUBLIC_PASS ${entry.id}\n`);
  } finally { await shell.dispose(); }
}
process.stdout.write(JSON.stringify({ s06PublicFlows: cases.length }) + "\n");
