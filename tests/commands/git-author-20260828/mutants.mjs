import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
const root = process.env.GIT_AUTHOR_ROOT, kind = process.env.GIT_AUTHOR_MUTANT;
const { MemoryFileSystem } = await import(pathToFileURL(path.join(root, 'dist/index.js')).href);
const { createGitCommand } = await import(pathToFileURL(path.join(root, 'dist/commands/git/index.js')).href);
const fixture = JSON.parse(await fs.readFile(new URL('fixture.json', import.meta.url)));
const memory = new MemoryFileSystem();
for (const file of fixture.files) {
  const target = '/repo/' + file.path; await memory.mkdir(path.posix.dirname(target), { recursive: true });
  await memory.writeFile(target, file.text === undefined ? Buffer.from(file.base64, 'base64') : Buffer.from(file.text));
}
if (kind === 'hash') await memory.writeFile('/repo/.git/objects/f7/19efd430d52bcfc8566a43b2eb655688d38871', deflateSync(Buffer.from('blob 4\0bad\n')));
if (kind === 'pack') { await memory.mkdir('/repo/.git/objects/pack'); await memory.writeFile('/repo/.git/objects/pack/a.pack', Buffer.from('PACK')); }
const cleanups = [], out = [], err = [];
const result = await createGitCommand().execute({ command: 'git', args: kind === 'exit' ? ['diff', '--quiet'] : ['show', 'HEAD:src/app.txt'], cwd: '/repo', env: {}, signal: new AbortController().signal, fs: memory,
  stdin: { async *[Symbol.asyncIterator]() { throw new Error('stdin unexpectedly read'); } }, stdout: { async write(bytes) { out.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { err.push(Buffer.from(bytes)); } }, registerCleanup(fn) { cleanups.push(fn); } });
await Promise.all(cleanups.map(fn => fn()));
console.log(JSON.stringify({ kind, observed: result.exitCode, stdout: Buffer.concat(out).toString('hex'), stderr: Buffer.concat(err).toString() }));
assert.equal(result.exitCode, kind === 'exit' ? 1 : 128, `semantic ${kind} guard must remain`);
