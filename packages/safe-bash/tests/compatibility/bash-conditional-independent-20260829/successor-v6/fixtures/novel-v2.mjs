import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as api from 'virtual-bash';
import * as contractLeaf from 'virtual-bash/contracts';
const cases = JSON.parse(fs.readFileSync(new URL('./NOVEL-CASES.json', import.meta.url), 'utf8'));
const rows = [];
for (const spec of cases) {
  if (process.env.NOVEL_CASE && process.env.NOVEL_CASE !== spec.id) continue;
  const row = { id: spec.id, role: 'INDEPENDENT_PROJECT_PROFILE_NOT_NATIVE', pass: false };
  const memory = new api.MemoryFileSystem(); const shell = new api.Shell({ fs: memory, cwd: '/', env: { LC_ALL: 'C' } }).use(api.agentCommands());
  const timer = setTimeout(() => { console.error('CASE_DEADLINE', spec.id); process.exit(78); }, 30000);
  try {
    assert.equal(contractLeaf.FsError, api.FsError);
    if (spec.id === 'N03') assert.throws(() => api.parseShell(spec.program), error => error instanceof api.ShellSyntaxError && error.reason === 'Expected conditional operand');
    const result = await shell.exec(spec.program); row.actual = result;
    const expected = spec.id === 'N11' ? { exitCode: 1, stdout: '', stderr: '', files: { out: 'shell: line 1: missing: unbound variable\n' } } : spec.projectExpected;
    assert.equal(result.exitCode, expected.exitCode); assert.equal(result.stdout, expected.stdout);
    if (expected.stderr !== undefined) assert.equal(result.stderr, expected.stderr);
    else if (spec.id === 'N03') assert.match(result.stderr, /Expected conditional operand/);
    else {
      const detail = spec.id === 'N06' ? 'extglob' : spec.id === 'N08' ? 'numeric expression or literal' : '=~';
      assert.equal(result.stderr, 'shell: line 1: [[ ' + detail + ': unsupported conditional profile\n');
    }
    const names = (await memory.readdir('/')).map(entry => typeof entry === 'string' ? entry : entry.name).sort();
    assert.deepEqual(names, Object.keys(expected.files).sort());
    row.files = {};
    for (const [name, content] of Object.entries(expected.files)) { const actual = new TextDecoder().decode(await api.readBytes(await memory.readFile('/' + name))); assert.equal(actual, content); row.files[name] = actual; }
    row.pass = true;
  } catch (error) { row.error = String(error?.stack ?? error); }
  finally { try { await shell.dispose(); row.disposed = true; } catch (error) { row.cleanupError = String(error); } clearTimeout(timer); }
  rows.push(row); console.log(JSON.stringify(row)); if (row.cleanupError) process.exit(78);
}
console.log(JSON.stringify({ summary: { cases: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, native: 0 } }));
process.exitCode = rows.every(row => row.pass) ? 0 : 1;

