import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { recipe, repository, read, sha, fileHash, safe, save, tarEntries, matchInventory } from './io.mjs';

const baseline = '5137a74ec855a32d8a8860eb66b62eb44d11e290', candidate = '9ed9a0f14d12758713a8dc42be1ff75f0c87a36f';
const author = 'tests/commands/timeout-author-20260828/evidence-v2';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
assert.equal(fileHash(git), '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9');
const gitRead = (...args) => execFileSync(git, ['--no-replace-objects', '--no-optional-locks', '-C', repository, ...args], { maxBuffer: 16 * 1024 ** 2, timeout: 15000 });
const manifest = read(join(repository, author, 'SOURCE-MANIFEST.json'));
assert.equal(manifest.baseline, baseline); assert.equal(manifest.moduleCommit, candidate);
const selected = gitRead('ls-tree', '-r', baseline).toString().trim().split('\n').map(line => { const [header, path] = line.split('\t'), [mode, type, blob] = header.split(' '); return { mode, type, blob, path }; }).filter(row => row.path.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(row.path)).filter(row => !row.path.startsWith('src/commands/timeout/'));
selected.push(...gitRead('ls-tree', '-r', candidate, '--', 'src/commands/timeout').toString().trim().split('\n').map(line => { const [header, path] = line.split('\t'), [mode, type, blob] = header.split(' '); return { mode, type, blob, path }; }));
assert.equal(selected.length, 268);
for (const row of manifest.entries) {
  safe(row.path); const actual = selected.find(entry => entry.path === row.path); assert.ok(actual); assert.equal(actual.type, 'blob'); assert.equal(actual.mode, row.mode); assert.equal(actual.blob, row.blob); assert.equal(row.commit, row.path.startsWith('src/commands/timeout/') ? candidate : baseline);
  const bytes = gitRead('cat-file', 'blob', row.blob); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
}
const archivePath = `${author}/SOURCE.tar`, packPath = `${author}/package/virtual-bash-0.0.0.tgz`;
assert.equal(fileHash(join(repository, archivePath)), '1a7f280f4f309af3dcc8f3a7ec629b95dddbc65d180bc45c9911ff64523d6ded');
const archive = tarEntries(fs.readFileSync(join(repository, archivePath))); matchInventory(archive, manifest.entries);
assert.equal(fileHash(join(repository, packPath)), '32e2bef5eafbb00e9b6704e2765f55e36514eda0da0fe84ea78367813c756630');
const packed = tarEntries(fs.readFileSync(join(repository, packPath)), true); assert.equal(packed.length, 857);
for (const row of packed) assert.ok(row.path.startsWith('package/'));
const closurePath = 'tests/integration/du-public-independent-evidence-20260827/admission-v2/closure.json';
const closure = read(join(repository, closurePath));
const protectedRows = read(join(repository, 'tests/commands/timeout-independent-20260828/review-preparation-v1/recipe/PROTECTED.json'));
for (const [prefix, file] of [[author, 'EVIDENCE-SEAL.json'], ['tests/commands/timeout-independent-20260828/review-preparation-v1', 'EVIDENCE-MANIFEST.json']]) {
  const document = read(join(repository, prefix, file)); protectedRows.push({ path: `${prefix}/${file}`, sha256: fileHash(join(repository, prefix, file)) });
  for (const row of Array.isArray(document.files) ? document.files : Object.entries(document.files).map(([path, sha256]) => ({ path, sha256 }))) protectedRows.push({ path: `${prefix}/${row.path}`, sha256: row.sha256 });
}
protectedRows.push({ path: closurePath, sha256: fileHash(join(repository, closurePath)) });
for (const row of protectedRows) assert.equal(fileHash(join(repository, row.path)), row.sha256, row.path);
const oldBindings = read(join(repository, 'tests/commands/timeout-independent-20260828/BINDINGS.json'));
const diagnosticBytes = fs.readFileSync(join(repository, oldBindings.diagnostics[0].source), 'utf8');
const diagnostics = diagnosticBytes.split('\n').filter(line => line && !line.startsWith('#')).map(line => { const [label, status, stream, length, base64] = line.split('\t'); const bytes = Buffer.from(base64, 'base64'); return { label, status: Number(status), stream, bytes: Number(length), sha256: sha(bytes), base64 }; });
assert.equal(diagnostics.length, 14); for (const row of diagnostics) { const frozen = oldBindings.diagnostics.find(item => item.label === row.label); assert.equal(row.sha256, frozen.sha256); assert.equal(row.bytes, frozen.bytes); }
const source = archive.find(row => row.path === 'src/commands/timeout/index.ts').body.toString();
const replaceLast = (text, before, after) => { const offset = text.lastIndexOf(before); assert.ok(offset >= 0); return text.slice(0, offset) + after + text.slice(offset + before.length); };
const mutants = [
  { id: 'M01', caseId: 'PC01', basis: 'PC01 raw handler caller priority counterfactual', before: '      context.signal.throwIfAborted();', after: '      void context.signal;', failure: 'HANDLER_RETURNED_STATUS' },
  { id: 'M02', caseId: 'PC02', basis: 'PC02 actual retirement failure counterfactual', before: '      if (retirementFailed) throw retirementFailure;', after: '      if (retirementFailed && retirementFailure !== deadline.deadlineReason) throw retirementFailure;', failure: 'RETIREMENT_MAPPED_TO_STATUS' },
].map(row => { const bytes = Buffer.from(replaceLast(source, row.before, row.after)); return { ...row, originalSha256: sha(source), mutantSha256: sha(bytes), bytes: bytes.length, selection: 'last exact occurrence only; owned isolated mutant tree, never original candidate' }; });
const staticProof = { status: 'PASS', kind: 'independent-static-source-proof-not-timing', parserSha256: '870a3800f9ba46a1d38ed831d0b6e7da804d4d34c6f5d3ebe86ada535d90b835', sourceCommit: candidate, proof: ['one suffix charCodeAt(length-1), one descending index loop: at most n+1 code-unit reads even for empty input', 'fixed scalar locals; no full-input copy, token regex, BigInt, pow, second traversal or duration-sized loop', 'integer digit addition checked against floor((q-I)/p), q=floor(MAX/M), p advancement checked against floor(q/10)', 'fraction temporary=d*M+c <=9*M+(M-1)=10*M-1<=863999999; floor division/sticky preserve exact rational ceil once', 'invalid scanning continues after integerOverflow; grammar rejection precedes overflow and missing command', 'product I*M <= MAX; final fraction checked against MAX-product before addition; no new parser counter/token cap'], sourceOnlyScope: true, instrumentation: 'not needed for this explicit scalar-loop source proof' };
save(join(recipe, 'BINDINGS.json'), { schema: 'timeout-independent-actual-binding/1', preparedAt: new Date().toISOString(), baseline, candidate, sourceArchive: { path: archivePath, sha256: fileHash(join(repository, archivePath)), bytes: 2586112 }, pack: { path: packPath, sha256: fileHash(join(repository, packPath)), bytes: 736428, members: 857 }, inputs: manifest.entries, packageFiles: packed.map(({ path, mode, bytes, sha256 }) => ({ path: path.slice(8), mode, bytes, sha256 })), closurePath, protectedRows, diagnostics, numeric: read(join(repository, 'tests/commands/timeout-independent-20260828/NUMERIC.json')).vectors, mutants, staticProof, scope: 'baseline5137 plus exact four module files; no full candidate HEAD or root integration claim' });
console.log(JSON.stringify({ bound: 268, module: 4, packageMembers: 857, mutants: 2, sourceExecution: 0, movedExecution: 0, nativeExecution: 0 }));
