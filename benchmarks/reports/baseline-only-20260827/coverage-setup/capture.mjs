import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { inventory } from '../../../expanded/inventory.mjs';
import * as baseline from '../../../node_modules/just-bash/dist/bundle/index.js';

const root = '/Users/kjopek/Workspace/safe-bash';
assert.equal(process.cwd(), root);
const destination = 'benchmarks/reports/baseline-only-20260827/coverage-setup';
const base = 'benchmarks/node_modules/just-bash';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const recordFile = path => ({ path, bytes: statSync(path).size, sha256: sha256(readFileSync(path)) });
const publish = (name, data) => execFileSync('apply_patch', [`*** Begin Patch\n*** Add File: ${destination}/${name}.json\n${JSON.stringify(data, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`], { stdio: 'inherit' });
const current = await inventory(root, `${root}/${base}`);
const historical = readJson('benchmarks/reports/expanded-20260827/baseline-only-frozen/matrix.json');
const bundlePath = `${base}/dist/bundle/index.js`;
const bundle = readFileSync(bundlePath, 'utf8');
const registry = new Map([...bundle.matchAll(/\{name:"([^"]+)",load:async\(\)=>\(await import\("([^"]+)"\)\)\.([\w$]+)/g)].map(match => [match[1], { bundlePath, byteOffset: Buffer.byteLength(bundle.slice(0, match.index)), lazyImport: match[2], export: match[3] }]));
const dispatcherPosition = bundle.indexOf('if(t==="cd")');
const dispatcherStart = bundle.lastIndexOf('async function ', dispatcherPosition);
const dispatcherEnd = bundle.indexOf('async function ', dispatcherPosition);
const dispatcherBody = bundle.slice(dispatcherStart, dispatcherEnd);
const staticKernel = name => {
  const position = dispatcherBody.indexOf(`t===${JSON.stringify(name)}`);
  assert.ok(position >= 0, `Missing concrete kernel branch: ${name}`);
  const tail = dispatcherBody.slice(position);
  const nextBranch = tail.indexOf('if(t===', 1);
  const remaining = nextBranch < 0 ? tail : tail.slice(0, nextBranch);
  const handler = remaining.match(/return (?:await )?([\w$]+)\(/)?.[1] ?? 'inline-return';
  const handlerPosition = bundle.indexOf(`function ${handler}(`);
  return { path: bundlePath, dispatcher: 'df', byteOffset: Buffer.byteLength(bundle.slice(0, dispatcherStart + position)), handler, handlerByteOffset: handlerPosition < 0 ? null : Buffer.byteLength(bundle.slice(0, handlerPosition)), evidence: 'Concrete branch and handler inspected; not an execution pass' };
};
const optionalNames = [...baseline.getNetworkCommandNames(), ...baseline.getPythonCommandNames(), ...baseline.getJavaScriptCommandNames()];
const optionalInstance = new baseline.Bash({ python: true, javascript: true, fetch: async () => { throw new Error('Inventory must never fetch'); } });
const enabledNames = [...optionalInstance.commands.keys()].sort();
assert.ok(optionalNames.every(name => enabledNames.includes(name)));
const oursAll = [...new Set([...current.virtual.union, ...current.virtual.optional])].sort();
const expandedOnly = [...new Set([...current.baseline.union, ...optionalNames])].filter(name => !oursAll.includes(name)).sort();
const rows = historical.rows.map(row => ({
  ...row,
  currentOurs: current.virtual.union.includes(row.name) ? { classification: 'concrete-kernel-handler-present-unexecuted', reference: 'src/shell/runtime.ts:802', handler: row.name === 'eval' ? 'evalBuiltin' : 'sourceBuiltin', operationalProof: false } : { classification: 'no-public-default-or-optional-handler', reference: 'src/plugins/index.ts:34; src/shell/runtime.ts:802,814,843', operationalProof: false },
  currentBaseline: { classification: row.name === 'wait' ? 'kernel-no-op-not-job-join-proof' : row.baselineKernel ? 'kernel-handler-present-unexecuted' : 'lazy-registry-handler-present-unexecuted', registry: registry.get(row.name) ?? null, kernel: row.baselineKernel ? staticKernel(row.name) : null },
  currentBaselineOnly: current.baselineOnlyNames.includes(row.name),
}));
const addedOptional = expandedOnly.filter(name => !historical.rows.some(row => row.name === name)).map(name => ({ name, coverage: 'not-measured-in-frozen-cohort', historicalMembership: false, currentOurs: 'no-public-handler; SafeJS is not a name-compatible replacement', baseline: { classification: name === 'node' ? 'registered-diagnostic-stub-not-JavaScript-execution' : 'optional-runtime-handler-present-unexecuted', registry: registry.get(name), setup: ['python', 'python3'].includes(name) ? { python: true } : { javascript: true } } }));
publish('inventory', { capturedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), method: 'Public definitions, constructor registration and read-only concrete dispatcher inspection; NO Bash.exec, Shell.exec or command handler invocation', historical: { commit: '20b889b', totals: historical.totals, input: recordFile('benchmarks/reports/expanded-20260827/baseline-only-frozen/matrix.json') }, current, optionalEnabledNames: enabledNames, counts: { defaultBaselineOnlyUnmeasured: current.baselineOnlyNames.length, additionalOptionalBaselineOnlyUnmeasured: addedOptional.length, inclusiveUnmeasuredNames: expandedOnly.length, inclusiveOperationalCandidatesExcludingNodeStub: expandedOnly.length - 1 }, exactDefaultUnmeasuredNames: current.baselineOnlyNames, exactInclusiveUnmeasuredNames: expandedOnly, newlyOverlappingHistoricalNames: rows.filter(row => !row.currentBaselineOnly).map(row => row.name), rows, addedOptional, caveats: ['50 default names are unmeasured in the frozen primary comparison, not globally untested across all product tests.', 'Optional-inclusive 54 retains node as an unmeasured diagnostic-only name; no positive-runtime score is possible for its pinned stub.', 'Historical 53/3/50 and original three failures remain unchanged.', 'curl is optional on BOTH sides and is not baseline-only; safejs is optional ours-only.', 'No classifier-only name is promoted to a concrete command.'] });

const pkg = readJson(`${base}/package.json`);
const lock = readJson('benchmarks/package-lock.json');
const requireFromBaseline = createRequire(resolve(`${base}/package.json`));
const dependencies = Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies }).map(([name, range]) => {
  let entry;
  try { entry = requireFromBaseline.resolve(name); } catch (error) { return { name, range, optional: name in pkg.optionalDependencies, available: false, reason: error.code }; }
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    const candidate = `${directory}/package.json`;
    if (existsSync(candidate) && readJson(candidate).name === name) break;
    directory = dirname(directory);
  }
  return { name, range, optional: name in pkg.optionalDependencies, available: true, version: readJson(`${directory}/package.json`).version, entrypoint: recordFile(entry), package: recordFile(`${directory}/package.json`), lock: lock.packages[`node_modules/${name}`] ?? null };
});
const assets = [];
const walkAssets = path => { for (const item of readdirSync(path, { withFileTypes: true })) { const child = `${path}/${item.name}`; if (item.isDirectory()) walkAssets(child); else if (/\.wasm$|python313\.zip$|python\.cjs$|(?:sqlite3-|js-exec-)?worker\.js$/.test(item.name)) assets.push(recordFile(child)); } };
for (const directory of [base, 'benchmarks/node_modules/sql.js', 'benchmarks/node_modules/@jitl']) walkAssets(directory);
const before = readJson(`${destination}/before.json`);
const report = readJson('benchmarks/reports/expanded-20260827/corrected-bd2cacb/report.json');
const nativeTools = { input: 'benchmarks/reports/expanded-20260827/native-scratch-aligned/native.json', liveManifest: 'native-and-helper-before.json', note: 'Historical profile and current native-file metadata are recorded separately; no native cases executed.' };
publish('setup-local', { capturedAt: new Date().toISOString(), node: process.version, package: recordFile(`${base}/package.json`), baselineVersion: pkg.version, entrypoints: pkg.exports, engines: pkg.engines, lockEntry: lock.packages['node_modules/just-bash'], dependencies, assets, nativeHistoricalProfile: nativeTools, sourceFreeze: { path: `${destination}/before.json`, manifestSha256: before.fileManifestSha256 }, integrityBoundary: 'Lockfile SRI plus publisher metadata and installed-file SHA256 manifests. No tarball re-download, signature verification, install, build, native addon loading or runtime startup occurred; package content is not claimed fully re-attested against registry SRI.', safejsInstalledPackageSearch: { roots: ['node_modules', 'benchmarks/node_modules'], maxDepth: 3, matches: [], limitation: 'No host-private checkout searched or loaded; legitimate runtime must be provided by host outside this assignment.' } });

const commit = 'a021f95f53f7e01df48dab71b46ffd4637fb4b53';
const sources = [
  ['README.md', 'Pinned package README matches installed bytes; documents opt-in JS/Python, default SQLite, local VFS and network policy.'],
  ['package.json', 'Pinned package manifest and runtime dependency declarations.'],
  ['src/Bash.ts', 'Constructor supports python:boolean, javascript:boolean/config, network, injected SecureFetch, sleep and named execution profiles.'],
  ['src/commands/registry.ts', 'Concrete lazy registry distinguishes defaults, network, Python, and JS; node routes to nodeStubCommand.'],
  ['src/commands/js-exec/README.md', 'JavaScript/TypeScript QuickJS CLI uses -c or file, not guessed node flags.'],
  ['src/commands/js-exec/js-exec.ts', 'Node alias is diagnostic-only; JS worker loaded adjacent to bundled command.'],
  ['src/commands/python3/worker.ts', 'Vendored CPython Emscripten loader and stdlib ZIP resolved locally.'],
  ['src/commands/sqlite3/worker.ts', 'Worker initializes sql.js locally; no constructor sqlite boolean exists.'],
  ['src/commands/html-to-markdown/html-to-markdown.ts', 'Local file/stdin conversion does not require networking. Direct URL operands are not fetched; use explicitly configured curl piped to this command for URL workflows.'],
  ['src/network/fetch.ts', 'Injected SecureFetch returns body Uint8Array and takes per-request options including signal.'],
];
const docs = [];
for (const [path, paraphrase] of sources) {
  const url = `https://raw.githubusercontent.com/vercel-labs/just-bash/${commit}/packages/just-bash/${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  docs.push({ url, accessedAt: new Date().toISOString(), status: response.status, bytes: bytes.length, sha256: sha256(bytes), version: '3.4.2', commit, paraphrase, installedIdentical: path === 'README.md' ? bytes.equals(readFileSync(`${base}/README.md`)) : null });
  assert.equal(response.status, 200);
}
const metadataUrl = 'https://registry.npmjs.org/just-bash/3.4.2';
const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(15000) });
const metadataBytes = Buffer.from(await response.arrayBuffer());
const metadata = JSON.parse(metadataBytes);
assert.equal(metadata.dist.integrity, lock.packages['node_modules/just-bash'].integrity);
publish('primary-sources', { accessedAt: new Date().toISOString(), researchMethod: 'web.run open/search first; Git read-only ls-remote and HTTPS GET of primary pinned sources as fallback. No third-party recommendations used.', officialRepository: 'https://github.com/vercel-labs/just-bash', tag: 'just-bash@3.4.2', commit, mainObserved: 'de3c2f368ee1c11bab4d7250aaf43306e052a008', mainPolicy: 'Current main is monorepo; only pinned package sources determine this setup.', docs, publisher: { url: metadataUrl, accessedAt: new Date().toISOString(), status: response.status, sha256: sha256(metadataBytes), version: metadata.version, dist: metadata.dist, integrityEqualsLock: true }, docConflicts: ['Installed dist/AGENTS.md says no binaries/WASM but separately lists optional WASM runtimes; precise README/types/worker assets override this overbroad summary.', 'README groups html-to-markdown with network, but local file/stdin conversion is default and needs no fetch.', 'README optional runtime list omits node diagnostic alias; registry/source expose it, so retain without claiming execution.'] });
