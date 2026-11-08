import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, cpSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const owned = resolve('tests/shell-stress/first-read-contract-review');
const candidate = resolve(owned, '.scratch/candidate');
const pin = JSON.parse(readFileSync(resolve(owned, 'evidence/freeze.json')));
const hash = value => createHash('sha256').update(value).digest('hex');
const paths = [
  'tests/shell/remote-close.test.ts', 'tests/shell/first-read-probe.ts',
  'tests/shell/remote-close-probe.ts', 'tests/shell/helpers.ts',
  'tests/stress/remote-cancellation/helpers.ts', 'tests/fs/webdav/mock.ts',
  'tests/shell/lifecycle.test.ts', 'tests/shell/lifecycle-probe.ts',
  'tests/shell/streaming.test.ts', 'tests/contracts/io.test.ts',
  'tests/contracts/io.stress.test.ts', 'tsconfig.build.json',
];
const archives = [
  'tests/shell/first-read-evidence.json',
  'tests/shell/first-read-independent.snapshot.mjs',
  'tests/shell/first-read-guard.snapshot.mjs',
  'tests/integration/full-gate-20260827/evidence/recheck/shell-first-read-plain.stdout.log',
  'tests/integration/full-gate-20260827/evidence/recheck/shell-first-read-plain.stderr.log',
  'docs/OUTPUT_LIFECYCLE_REVIEW.md', 'README.md',
];
const manifest = [];
for (const path of [...paths, ...archives]) {
  const bytes = readFileSync(path);
  const expected = pin.manifest.find(entry => entry.path === path);
  if (expected && expected.sha256 !== hash(bytes)) throw new Error(`Changed frozen input ${path}`);
  const archive = resolve(owned, 'preserved', `${path}.data`);
  mkdirSync(dirname(archive), { recursive: true });
  writeFileSync(archive, bytes, { flag: 'wx' });
  manifest.push({ path, sha256: hash(bytes), bytes: bytes.length, matchedInitialFreeze: !!expected,
    classification: paths.includes(path) ? 'unchanged execution input, archived as inert data' : 'historical/reference bytes, not executed', archive });
  if (paths.includes(path)) {
    mkdirSync(dirname(resolve(candidate, path)), { recursive: true });
    cpSync(path, resolve(candidate, path));
  }
}
const tools = ['node_modules/tsx/package.json', 'node_modules/tsx/dist/loader.mjs',
  'node_modules/typescript/package.json', 'node_modules/typescript/lib/tsc.js',
  'node_modules/typescript/lib/_tsc.js', 'node_modules/@types/node/package.json',
  'node_modules/esbuild/package.json', 'node_modules/esbuild/bin/esbuild'];
writeFileSync(resolve(owned, 'evidence/inputs.json'), JSON.stringify({ preparedAt: new Date().toISOString(),
  head: pin.head, controlsSha256: hash(readFileSync(resolve(owned, 'CONTROLS.md'))), manifest,
  tools: tools.map(path => ({ path, realpath: realpathSync(path), sha256: hash(readFileSync(path)) })),
  dependencyPolicy: 'Existing ancestor dev node_modules resolution explicitly used; no install/copy/product dependencies. No packed proof.' }, null, 2) + '\n', { flag: 'wx' });
console.log(`Preserved ${manifest.length} inputs; source pin ${pin.head}`);
