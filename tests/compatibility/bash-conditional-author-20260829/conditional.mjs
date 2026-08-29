import assert from 'node:assert/strict';
import * as api from 'virtual-bash';
const { parseShell } = api;
const shells = new Set(), rows = [];
const capture = promise => promise.then(value => ({ value }), reason => ({ reason }));
function create(memory = new api.MemoryFileSystem(), options = {}) { const shell = new api.Shell({ fs: memory, cwd: '/', ...options }).use(api.agentCommands()); shells.add(shell); return shell; }
async function record(id, body) {
  if (process.env.CONDITIONAL_CASE && process.env.CONDITIONAL_CASE !== id) return;
  const row = { id, role: 'RATIFIED_PRODUCT_PROFILE_NOT_NATIVE_GOLDEN', pass: false };
  const timer = setTimeout(() => { console.error('CASE_DEADLINE', id); process.exit(78); }, 30000);
  try { await body(row); row.pass = true; } catch (error) { row.error = String(error?.stack ?? error); }
  finally { const disposed = await Promise.allSettled([...shells].map(shell => shell.dispose())); row.created = shells.size; row.disposed = disposed.filter(item => item.status === 'fulfilled').length; row.cleanupFailure = row.created !== row.disposed; shells.clear(); clearTimeout(timer); }
  rows.push(row); console.log(JSON.stringify(row)); if (row.cleanupFailure) process.exit(78);
}
const scripts = [
  ['A01', '[[ "" ]]', 1], ['A02', '[[ value ]]', 0],
  ['A03', 'IFS=:; x="a:b c"; [[ $x == "a:b c" ]]', 0],
  ['A04', 'x="*"; [[ $x == "*" ]]', 0], ['A05', '[[ "]]" == "]]" ]]', 0],
  ['A06', '[[ alpha == a* ]]', 0], ['A07', '[[ alpha == "a*" ]]', 1],
  ['A08', '[[ "a*b" == "a*"? ]]', 0], ['A09', 'p="a*"; [[ alpha == $p ]]', 0],
  ['A10', 'p="a*"; [[ alpha == "$p" ]]', 1], ['A11', '[[ beta != a* && beta = b* ]]', 0],
  ['A12', '[[ "a*b" == a\\*b ]]', 0], ['A13', '[[ b == [a-c] ]]', 0],
  ['A14', '[[ ab == @(ab|cd) ]]', 2], ['A15', '[[ "@(ab|cd)" == "@(ab|cd)" ]]', 0],
  ['A16', '[[ "" && $(printf bad > marker) ]]', 1],
  ['A17', 'set -u; [[ x || $missing ]]; printf after', 0, 'after'],
  ['A18', '[[ x || "" && "" ]]', 0], ['A19', '[[ ! ( x && "" ) ]]', 0],
  ['A20', 'x="||"; [[ $x == "||" ]]', 0],
  ['A21', '[[ $(printf once >> visits; printf value) == v* ]]', 0],
  ['A22', '[[ -f file && -d dir && ! -f dir && ! -e "" ]]', 0],
  ['A23', '[[ -L dangling && ! -e dangling && -h link ]]', 0],
  ['A24', '[[ -s file && ! -s empty && -r file && -w file && -x executable ]]', 0],
  ['A25', 'unset x; [[ -v x ]]', 1], ['A26', 'x=; [[ -v x ]]', 0],
  ['A27', 'a=(); a[3]=; [[ -v a[3] && ! -v a[0] && -v a[@] ]]', 0],
  ['A28', 'set -u; [[ -o nounset && ! -o pipefail ]]', 0],
  ['A29', '[[ A < z && z > A ]]', 0],
  ['A30', '[[ 010 -eq 8 && -2 -lt 0 && 16#ff -eq 255 ]]', 0],
  ['A31', 'x=; [[ $x -eq 0 ]]', 0], ['A32', 'set -- a; [[ $# -gt 0 ]]', 0],
  ['A33', '[[ x+1 -eq 3 ]]', 2], ['A34', '[[ x =~ (x)+ ]]', 2],
  ['A35', '[[ x || x =~ (x)+ ]]', 0], ['A36', '[[ "" ]] > out', 1],
  ['A37', 'f() [[ x == x ]]; f |& printf pipe; [[ x ]] &> combined', 0, 'pipe'],
  ['A38', 'set -e; if [[ "" ]]; then printf bad; fi; printf after', 0, 'after'],
  ['A39', 'set -e; [[ "" ]]; printf bad', 1],
  ['A40', 'set -u; f() { [[ $missing ]]; printf bad; }; f; printf bad', 1],
];
for (const [id, program, status, stdout = ''] of scripts) await record(id, async row => {
  const memory = new api.MemoryFileSystem();
  await memory.writeFile('/file', Buffer.from('data')); await memory.writeFile('/empty', new Uint8Array()); await memory.mkdir('/dir');
  await memory.writeFile('/executable', Buffer.from('x'), { mode: 0o755 }); await memory.symlink('/missing', '/dangling'); await memory.symlink('/file', '/link');
  const result = await create(memory).exec(program); row.actual = { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  assert.equal(result.exitCode, status); assert.equal(result.stdout, stdout);
  if (status === 2) assert.match(result.stderr, /unsupported conditional profile/);
  else if (id === 'A40') assert.match(result.stderr, /missing: unbound variable/);
  else assert.equal(result.stderr, '');
  if (id === 'A16') await assert.rejects(memory.stat('/marker'), error => error.code === 'ENOENT');
  if (id === 'A21') assert.equal(Buffer.from(await memory.readFile('/visits')).toString(), 'once');
  if (id === 'A36') assert.equal((await memory.stat('/out')).size, 0);
  if (id === 'A37') assert.equal((await memory.stat('/combined')).size, 0);
});
function adapted(memory, changes) { return new Proxy(memory, { get(target, key) { if (Object.hasOwn(changes, key)) return changes[key]; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }); }
await record('H01', async () => { const reason = Object.freeze({ caller: true }), controller = new AbortController(); controller.abort(reason); let reads = 0; const shell = create(adapted(new api.MemoryFileSystem(), { stat: async () => { reads++; throw Error('unreachable'); } })); assert.equal((await capture(shell.exec('[[ -f file ]]', { signal: controller.signal }))).reason, reason); assert.equal(reads, 0); });
await record('H02', async () => { const reason = Object.freeze({ during: true }), controller = new AbortController(); let closed = false; const shell = create(adapted(new api.MemoryFileSystem(), { stat: async (_path, options) => { try { controller.abort(reason); options.signal.throwIfAborted(); } finally { await new Promise(resolve => setImmediate(resolve)); closed = true; } } })); assert.equal((await capture(shell.exec('[[ -f file ]]', { signal: controller.signal }))).reason, reason); assert.equal(closed, true); });
await record('H03', async () => { let reads = 0; const shell = create(adapted(new api.MemoryFileSystem(), { stat: async () => { reads++; throw Error('unvisited'); } })); assert.equal((await shell.exec('[[ x || -f file ]]')).exitCode, 0); assert.equal(reads, 0); });
await record('H04', async () => { const shell = create(); const outcome = await capture(shell.exec('[[ abcdef == a* ]]', { limits: { maxExpansionBytes: 2 } })); assert.ok(outcome.reason instanceof api.ShellLimitError); assert.equal(outcome.reason.limit, 'maxExpansionBytes'); });
await record('H05', async () => { const reason = Object.freeze({ sink: true }); const result = await capture(create().exec('[[ x =~ x ]]', { stderr: { async write() { throw reason; } } })); assert.equal(result.reason, reason); });
await record('H06', async () => { const reason = Object.freeze({ provider: true }); const shell = create(adapted(new api.MemoryFileSystem(), { stat: async () => { throw reason; } })); assert.equal((await capture(shell.exec('[[ -f file ]]'))).reason, reason); });
await record('H07', async () => { const memory = new api.MemoryFileSystem(), shell = new api.Shell({ fs: memory }); shells.add(shell); assert.equal((await shell.exec('[[ x == x ]]')).exitCode, 0); assert.equal((await shell.exec('[[ "" ]]')).exitCode, 1); });
await record('H08', async () => { const expression = Array(2048).fill('x').join(' && '); const accepted = parseShell(`[[ ! ${expression} ]]`); assert.equal(accepted.lists[0].pipelines[0].commands[0].kind, 'conditional'); assert.throws(() => parseShell(`[[ x && ${expression} ]]`), error => error instanceof api.ShellSyntaxError && /4096/.test(error.reason)); assert.throws(() => parseShell(`[[ ${'('.repeat(64)}x${')'.repeat(64)} ]]`), error => error instanceof api.ShellSyntaxError && /64/.test(error.reason)); });
await record('H09', async () => { const shell = create(); const result = await shell.exec('BASH_REMATCH=keep; [[ x =~ x ]]; printf "%s" "$BASH_REMATCH"'); assert.equal(result.stdout, 'keep'); assert.match(result.stderr, /unsupported conditional profile/); const parsed = parseShell('[[ "a*" == "a*" ]]'); assert.ok(parsed.lists[0].pipelines[0].commands[0].expression.left.parts.every(part => part.quoted)); });
await record('H10', async () => { const shell = create(adapted(new api.MemoryFileSystem(), { capabilities: { permissions: false } })); const result = await shell.exec('[[ -r file ]]'); assert.equal(result.exitCode, 2); assert.match(result.stderr, /unobservable access permission/); });
console.log(JSON.stringify({ summary: { cases: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, native: 0 } }));
process.exitCode = rows.every(row => row.pass) ? 0 : 1;
