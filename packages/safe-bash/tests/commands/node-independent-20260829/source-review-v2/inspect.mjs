import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = '/Users/kjopek/Workspace/safe-bash';
const own = dirname(fileURLToPath(import.meta.url));
const source = 'c10d338331d56e1f293970010c7015fa602b6a8d';
const author = 'ee150ba1d2c9165118310d78de8d6453020b9271';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['README.md', 'admission.ts', 'channel.ts', 'cli.ts', 'diagnostics.ts', 'host.ts', 'index.ts', 'lifecycle.ts', 'lower.ts', 'program.ts', 'rules.ts', 'types.ts', 'values.ts', 'worker-main.ts', 'worker-provider.ts', 'worker-types.ts'];
const docs = ['API-v3.md', 'API-v4.md', 'CONTRACT.md', 'SOURCE-REPAIR-v3.json', 'MODULE-v4.json', 'PRESEAL-v1.json', 'EXECUTION-v1.md', 'WORKER-CASES-v1.json', 'engine-adapter-v1.mjs', 'BUILTINS-v1.json'];
const specs = [...sources.map(path => `${source}:src/commands/node/${path}`), ...docs.map(path => `${author}:tests/commands/node-author-20260829/${path}`), '797aa13996f04a332f37a84888d151f2352efee9:tests/commands/node-independent-20260829/preparation-v2/MATRIX.json'];
for (let path = own; path !== '/'; path = dirname(path)) {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`symlink scope ${path}`);
}
const mode = process.argv[2];
if (!['capture', 'show'].includes(mode)) throw new Error('DATA only: capture or show');
const child = spawnSync('/usr/bin/git', ['cat-file', '--batch'], { cwd: root, input: specs.join('\n') + '\n', encoding: null, maxBuffer: 8 * 1024 * 1024, timeout: 15000, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_OPTIONAL_LOCKS: '0' } });
if (child.error || child.signal || child.status !== 0) throw child.error ?? new Error(`metadata child ${child.status}/${child.signal}`);
if (child.stderr.length) throw new Error('unexpected metadata stderr');
let offset = 0;
const inputs = specs.map(spec => {
  const end = child.stdout.indexOf(10, offset);
  if (end < offset) throw new Error('missing header');
  const fields = child.stdout.subarray(offset, end).toString('ascii').split(' ');
  const size = Number(fields[2]);
  if (fields.length !== 3 || fields[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0 || size > 1024 * 1024) throw new Error(`invalid blob ${spec}`);
  offset = end + 1;
  const bytes = child.stdout.subarray(offset, offset + size);
  offset += size;
  if (bytes.length !== size || child.stdout[offset++] !== 10) throw new Error('short blob');
  const oid = createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex');
  if (oid !== fields[0]) throw new Error('blob integrity');
  return { spec, oid, bytes: size, sha256: hash(bytes), text: bytes.toString('utf8') };
});
if (offset !== child.stdout.length) throw new Error('trailing metadata');
if (mode === 'capture') {
  const capture = Buffer.from(JSON.stringify({ schema: 1, role: 'SOURCE-DATA-NOT-EXECUTABLE', source, author, inputs }));
  const archive = gzipSync(capture, { level: 9 });
  writeFileSync(resolve(own, 'SOURCE-DATA.json.gz.base64'), archive.toString('base64') + '\n', { flag: 'wx' });
  writeFileSync(resolve(own, 'INPUTS.json'), JSON.stringify({ source, author, captureSha256: hash(archive), decodedBytes: capture.length, compressedBytes: archive.length, child: { status: child.status, signal: child.signal, stderrBytes: child.stderr.length, stdoutBytes: child.stdout.length }, inputs: inputs.map(({ text, ...input }) => input) }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ inputs: inputs.length, bytes: capture.length, archive: hash(archive), child: 'natural-close', productExecutions: 0 }));
} else {
  const query = process.argv[3];
  const first = Number(process.argv[4] ?? 1);
  const last = Number(process.argv[5] ?? 240);
  if (!query || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last - first > 300) throw new Error('bounded display request');
  const input = inputs.find(item => item.spec.endsWith('/' + query));
  if (!input) throw new Error('unknown input');
  console.log(`${input.spec} SHA256 ${input.sha256}`);
  console.log(input.text.split('\n').slice(first - 1, last).map((line, index) => `${index + first}: ${line}`).join('\n'));
}
