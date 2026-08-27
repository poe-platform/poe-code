import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, lstatSync, readlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const output = dirname(fileURLToPath(import.meta.url));
const root = resolve(output, '../../../../..');
const fixture = 'tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl';
const gate = 'tests/integration/full-gate-20260827/combined-b494675c';
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, bytes) => { mkdirSync(dirname(resolve(output, path)), { recursive: true }); writeFileSync(resolve(output, path), bytes, { flag: 'wx' }); };
const describe = path => {
  const bytes = lstatSync(resolve(root, path)).isSymbolicLink() ? Buffer.from(readlinkSync(resolve(root, path))) : readFileSync(resolve(root, path));
  const committed = git('show', `HEAD:${path}`);
  return { path, bytes: bytes.length, sha256: sha256(bytes), gitBlob: git('rev-parse', `HEAD:${path}`).toString().trim(), committedSha256: sha256(committed), matchesHead: bytes.equals(committed) };
};
const paths = [`${fixture}/direct-curl.test.ts`, `${fixture}/expectations.json`, `${fixture}/source-pin.json`, ...readdirSync(resolve(root, fixture, 'artifacts')).map(name => `${fixture}/artifacts/${name}`)];
const pins = paths.map(describe);
for (const path of paths) save(`frozen/initial/${path.slice(fixture.length + 1)}.data`, readFileSync(resolve(root, path)));
const manifest = JSON.parse(readFileSync(resolve(root, gate, 'EVIDENCE_MANIFEST.json')));
const snapshots = manifest.captures.filter(entry => /artifact-(before|after)|tracked-artifact-reproducer|canonical\/report/.test(entry.key));
const preserved = [];
for (const entry of snapshots) {
  const stored = readFileSync(resolve(root, gate, entry.path));
  const bytes = entry.encoding === 'gzip-base64' ? gunzipSync(Buffer.from(stored.toString().trim(), 'base64')) : stored;
  if (sha256(stored) !== entry.storedSha256 || sha256(bytes) !== entry.originalSha256) throw new Error(`Historical manifest mismatch: ${entry.key}`);
  save(`frozen/historical/${entry.key}.data`, bytes);
  preserved.push({ ...entry, source: `${gate}/${entry.path}`, decodedSha256: sha256(bytes) });
}
const routing = JSON.parse(readFileSync(resolve(root, gate, 'FAILURE_ROUTING.json')));
const failures = routing.failures.filter(entry => ['historical-diagnostic-pin', 'historical-cleanup-pin'].includes(entry.group));
if (failures.length !== 99) throw new Error('Expected 99 exact historical rows');
save('frozen/99-diagnostics.json', JSON.stringify(failures, null, 2) + '\n');
const sourcePaths = git('ls-files', '-z', '--', 'src').toString().split('\0').filter(Boolean);
const source = sourcePaths.map(path => ({ path, sha256: sha256(readFileSync(resolve(root, path))) }));
save('frozen/baseline.json', JSON.stringify({ capturedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD').toString().trim(), gitStatus: git('status', '--porcelain=v1').toString(), foreignIndex: git('diff', '--cached', '--name-status').toString(), node: process.version, platform: process.platform, arch: process.arch, pins, source, sourceInventorySha256: sha256(JSON.stringify(source)), historical: preserved, gateRoutingSha256: sha256(readFileSync(resolve(root, gate, 'FAILURE_ROUTING.json'))) }, null, 2) + '\n');
console.log(JSON.stringify({ pins, historical: preserved.length, exactDiagnostics: failures.length }, null, 2));
