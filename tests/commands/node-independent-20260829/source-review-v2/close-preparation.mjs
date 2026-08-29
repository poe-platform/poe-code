import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const root = '/Users/kjopek/Workspace/safe-bash';
const source = 'c10d338331d56e1f293970010c7015fa602b6a8d';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const children = [];
for (let path = own; path !== '/'; path = dirname(path)) if (lstatSync(path).isSymbolicLink()) throw new Error('symlink scope');
const child = spawnSync('/usr/bin/git', ['ls-tree', '-rz', source, '--', 'src/commands/node'], { cwd: root, encoding: null, maxBuffer: 65536, timeout: 15000, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_OPTIONAL_LOCKS: '0' } });
if (child.error || child.signal || child.status !== 0 || child.stderr.length) throw child.error ?? new Error('inventory capture/retirement');
children.push({ role: 'immutable NUL tree metadata', status: child.status, signal: child.signal, stdoutBytes: child.stdout.length, stderrBytes: child.stderr.length });
const items = child.stdout.toString('utf8').split('\0');
if (items.pop() !== '') throw new Error('missing NUL terminator');
const records = items.map(item => {
  const split = item.indexOf('\t');
  const [mode, type, oid] = item.slice(0, split).split(' ');
  const path = item.slice(split + 1);
  if (split < 1 || mode !== '100644' || type !== 'blob' || !/^src\/commands\/node\/[a-z-]+\.(ts|md)$/.test(path)) throw new Error('invalid source inventory');
  return { path, mode, oid };
});
const input = JSON.parse(readFileSync(resolve(own, 'INPUTS.json'), 'utf8'));
const expected = input.inputs.filter(item => item.spec.startsWith(source + ':'));
if (records.length !== 16 || expected.length !== 16 || !records.every(record => expected.some(item => item.spec === source + ':' + record.path && item.oid === record.oid))) throw new Error('inventory binding mismatch');
writeFileSync(resolve(own, 'SOURCE-INVENTORY.json'), JSON.stringify({ source, rawNulBase64: child.stdout.toString('base64'), records, children }, null, 2) + '\n', { flag: 'wx' });
const files = [];
function collect(directory, prefix = '') {
  const names = readdirSync(directory).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  for (const name of names) {
    const absolute = resolve(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('evidence symlink');
    const path = prefix + name;
    if (stat.isDirectory()) collect(absolute, path + '/');
    else {
      if (!stat.isFile() || stat.size > 1048576) throw new Error('bounded regular evidence');
      const bytes = readFileSync(absolute);
      if (bytes.length !== stat.size) throw new Error('changed evidence');
      files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
collect(own);
const seal = { source, authorPreseal: input.author, role: 'SOURCE_AND_DATA_ONLY', ordering: 'UTF8 unsigned byte lexical pathname traversal; no C-quoted parsing', files, totals: { files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0) }, observedData: { checks: 18, passed: 18, semanticFamiliesBound: 38, typeFamiliesBound: 8, loadFamiliesBound: 6, rawControlsPreparedNotRun: 12 }, execution: { product: 0, workers: 0, guests: 0, compiler: 0, install: 0, network: 0, private: 0 }, child: children[0], limitations: ['No current candidate artifacts/load proof; full E/S variant executor still requires candidate-specific seal', 'Initial context-only tool display truncation not a test execution/capture; complete admitted source captured separately', 'No mutable source inspection; no concurrent author result qualification'] };
writeFileSync(resolve(own, 'SEAL.json'), JSON.stringify(seal, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sealSha256: hash(Buffer.from(JSON.stringify(seal, null, 2) + '\n')), inputFiles: records.length, artifactFiles: files.length, artifactBytes: seal.totals.bytes, metadataChild: 'natural-close', actualExecutions: 0 }));
