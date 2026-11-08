import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const large = '1' + '3'.repeat(174761);
const decimals = Array.from({ length: 8 }, (_, index) => `0.${'1'.repeat(24000)}${index + 1}`);
const specimens = [
  { id: 'empty-entry-cap', script: 'sort -ns', stdin: '\n'.repeat(16390) + '1\n-1\n0\n', expected: '-1\n' + '\n'.repeat(16390) + '0\n1\n' },
  { id: 'empty-entry-cap-unique', script: 'sort -nu', stdin: '\n'.repeat(16390) + '1\n-1\n0\n', expected: '-1\n\n1\n' },
  { id: 'character-cap-exact-with-empty', script: 'sort -ns', stdin: large + '\n\n\n', expected: '\n\n' + large + '\n' },
  { id: 'character-cap-one-record-too-large', script: 'sort -n', stdin: large + '3\n0\n', expected: '0\n' + large + '3\n' },
  { id: 'large-tail-small-value-bypass', script: 'sort -n', stdin: '2' + 'x'.repeat(180000) + '\n3\n1\n', expected: '1\n2' + 'x'.repeat(180000) + '\n3\n' },
  { id: 'character-cap-many-decimals', script: 'sort -ns', stdin: [...decimals].reverse().join('\n') + '\n', expected: decimals.join('\n') + '\n' },
  ...['-nb', '-nf', '-n -k1,1', '-n -k1,1n', '-n -k1,1n -k2,2r'].map(flags => ({ id: 'guard-' + flags.replaceAll(' ', '_'), script: 'sort ' + flags, stdin: ' 2 z\n\t1 a\n1 Z\n', expected: '\t1 a\n1 Z\n 2 z\n' })),
  { id: 'guard-check', script: 'sort -cn', stdin: '1\n2\n', expected: '' },
  { id: 'guard-plain', script: 'sort', stdin: '2\n1\n', expected: '1\n2\n' },
];
const descriptions = specimens.map(({ id, script, stdin, expected }) => ({ id, script, stdinSha256: hash(stdin), stdinBytes: Buffer.byteLength(stdin), stdoutSha256: hash(expected), stdoutBytes: Buffer.byteLength(expected), status: 0, stderr: '', files: {} }));
if (process.argv[2] === '--describe') console.log(JSON.stringify(descriptions));
else {
  const root = pathToFileURL(realpathSync(process.argv[2]) + '/').href;
  const imports = new Set();
  registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); assert.ok(result.url.startsWith('node:') || result.url.startsWith(root), result.url); imports.add(result.url); return result; } });
  const library = await import(root + 'dist/index.js');
  const rows = [];
  for (const specimen of specimens) {
    const counts = {};
    const count = (name, amount = 1) => { counts[name] = (counts[name] ?? 0) + amount; };
    globalThis.__sortProfile = { count, phase() {}, key() { count('keyExtractions'); }, numeric(bytes) { count('numericParses'); count('numericInputCopyBytes', bytes.length); } };
    const fs = library.createMemoryFileSystem();
    const shell = new library.Shell({ fs, env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, limits: { maxOutputBytes: 4194304, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } }).use(library.agentCommands());
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('bounded author caps')), 5000);
    let result;
    try { result = await shell.exec(specimen.script, { stdin: Buffer.from(specimen.stdin), signal: controller.signal }); }
    finally { clearTimeout(deadline); await shell.dispose(); globalThis.__sortProfile = undefined; }
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(specimen.expected));
    assert.deepEqual(await fs.readdir('/'), []);
    rows.push({ id: specimen.id, equivalent: true, stdoutSha256: hash(result.stdoutBytes), counts });
  }
  console.log(JSON.stringify({ rows, descriptions, imports: [...imports], shellsDisposed: rows.length }));
}
