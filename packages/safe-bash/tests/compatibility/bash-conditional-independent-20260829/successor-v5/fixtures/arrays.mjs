import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Shell, MemoryFileSystem, agentCommands, ShellLimitError } from 'virtual-bash';
const data = JSON.parse(fs.readFileSync(new URL('./ARRAY-CASES.json', import.meta.url)));
const encoder = new TextEncoder();
const rows = data.cases.filter(row => !process.env.ARRAY_CASE || row.id === process.env.ARRAY_CASE);
assert.equal(rows.length, process.env.ARRAY_CASE ? 1 : 12);
const observations = [];
for (const row of rows) {
  const filesystem = new MemoryFileSystem();
  const shell = new Shell({ fs: filesystem, cwd: '/w', ...(row.id === 'A12' ? { limits: { maxCommands: 1 } } : {}) }).use(agentCommands());
  const result = { id: row.id, pass: false, disposed: false };
  try {
    await filesystem.mkdir('/w', { recursive: true }); await filesystem.mkdir('/other');
    for (const [name, text] of Object.entries(data.files)) await filesystem.writeFile(name, encoder.encode(text));
    if (row.id === 'A11') shell.register({ name: 'relay', async execute(context) {
      assert.ok(context.invoke);
      assert.equal((await context.invoke('f', [])).exitCode, 0);
      assert.equal(context.signal.aborted, false);
      return { exitCode: 0 };
    } });
    const script = row.id === 'A11' ? `f(){ local a; a=(child); printf '%s\\n' "\${a[@]}"; }; ${row.script}` : row.script;
    if (row.id === 'A12') {
      await assert.rejects(shell.exec(script), error => error instanceof ShellLimitError && error.limit === 'maxCommands');
    } else {
      const actual = await shell.exec(script);
      result.actual = actual;
      assert.equal(actual.exitCode, row.status);
      assert.equal(actual.stdout, row.stdout);
      if (row.stderrContains) assert.ok(actual.stderr.includes(row.stderrContains));
      else assert.equal(actual.stderr, '');
    }
    result.pass = true;
  } catch (error) { result.error = { message: error?.message ?? String(error), code: error?.code, stack: error?.stack }; }
  finally { try { await shell.dispose(); result.disposed = true; } catch (error) { result.cleanupError = String(error); result.pass = false; } }
  observations.push(result); console.log(JSON.stringify(result));
}
const summary = { profile: 'coherent78-array-author-v1', cases: rows.length, pass: observations.filter(row => row.pass).length, disposed: observations.filter(row => row.disposed).length };
console.log(JSON.stringify({ summary }));
if (summary.pass !== summary.cases || summary.disposed !== summary.cases) process.exitCode = 1;

