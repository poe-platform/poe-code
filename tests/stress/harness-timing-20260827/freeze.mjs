import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const destination = fileURLToPath(new URL('frozen/', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString().trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const routing = git('rev-parse', '51282a9');
const baseline = 'e36dab2b6abc216ddc89e5786a0eba76f08a1722';
const jq = 'tests/commands/structured-stress/jq-grammar-author-20260827/';
const search = 'tests/commands/search-stress/';
const gate = 'tests/integration/full-gate-20260827/';
const harness = [jq + 'scan-boundaries.test.ts', jq + 'harness.ts', jq + 'native-boundary-frozen.json', search + 'streaming-cases.ts', search + 'streaming.test.ts', search + 'harness.ts'];
const historical = ['REPORT.md', 'evidence/classification.json', 'evidence/first/test.accounting.json', 'evidence/recheck/jq-scan-guarded.stdout.log', 'evidence/recheck/jq-scan-plain.stdout.log', 'evidence/recheck/rg-stream-plain-1.stdout.log', 'evidence/recheck/rg-stream-plain-2.stdout.log', 'evidence/recheck/rg-stream-plain-3.stdout.log'].map(path => gate + path);
const records = [];
function save(path, bytes, origin) {
  const target = resolve(destination, origin, path + '.txt');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
  records.push({ path, origin, sha256: digest(bytes), bytes: bytes.length });
}
for (const path of harness) {
  save(path, readFileSync(resolve(root, path)), 'initial-working');
  save(path, execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 }), 'fullgate-source');
}
for (const path of historical) save(path, execFileSync('git', ['show', `${routing}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 }), 'routing51282a9');
const classification = JSON.parse(readFileSync(resolve(destination, 'routing51282a9', gate + 'evidence/classification.json.txt')));
const failures = classification.failures.filter(row => ['jq-full-suite-deadline', 'native-rg-delivery-flake'].includes(row.classification));
const sourceHashes = Object.fromEntries(git('ls-files', 'src').split('\n').map(path => [path, digest(readFileSync(resolve(root, path)))]));
writeFileSync(resolve(destination, 'manifest.json'), JSON.stringify({ frozenAt: new Date().toISOString(), activity: 'static reads only; no product execution, native oracle or stress', routing, baseline, initialHead: git('rev-parse', 'HEAD'), status: git('status', '--short'), index: git('diff', '--cached', '--name-only'), records, sourceHashes, failures, historicalCounts: classification.counts, baselineTap: { path: gate + 'evidence/first/test.stdout.log', sha256: digest(readFileSync(resolve(root, gate + 'evidence/first/test.stdout.log'))) } }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ routing, baseline, files: records.length, originalFailures: failures.length, productFiles: Object.keys(sourceHashes).length }));
