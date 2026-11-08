import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '5137a74ec855a32d8a8860eb66b62eb44d11e290';
const FREEZE = '55810d4aea70fadf151c2fbf746a17f96bfeb599';
const MODULE = 'src/commands/xan/';
const CORE = 'tests/commands/xan-author-20260828/core/';
const PUBLIC = 'tests/commands/xan-independent-20260828/';
const PUBLIC_HASHES = {
  'FINAL-CONTRACT-V4.md': '130d9877dcca4a560b064c827adec95258baad14efc5dc00737a3ff39f4a0a61',
  'FINAL-BINDING-V4.json': '058782fddf4e18e2c36e665b5836a2543b897fdb1f908d1092df074975e5b30b',
};
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!['--candidate', '--audit-from', '--factory', '--runtime-entry'].includes(key) || !process.argv[index + 1] || key in options) throw new Error(`Invalid option ${key}`);
  options[key] = process.argv[index + 1];
}
if (!options['--candidate'] && Object.keys(options).length) throw new Error('Candidate required for candidate options');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024, timeout: 30_000 });
const textGit = (...args) => git(...args).toString().trim();
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const json = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const put = (root, path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
const tree = (revision, prefix) => git('ls-tree', '-rz', '--full-tree', revision, '--', prefix).toString().split('\0').filter(Boolean).map(entry => {
  const [metadata, path] = entry.split('\t');
  const [mode, type, blob] = metadata.split(' ');
  ensure(type === 'blob' && ['100644', '100755'].includes(mode), `Nonregular Git input: ${path}`);
  ensure(!path.split('/').some(part => ['..', '.git', 'node_modules', 'AGENTS.md'].includes(part)), `Forbidden input ${path}`);
  return { path, blob, mode };
}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const exportEntries = (revision, entries, destination) => entries.map(entry => {
  const bytes = git('cat-file', 'blob', entry.blob);
  put(destination, entry.path, bytes);
  return { ...entry, revision, bytes: bytes.length, sha256: sha256(bytes) };
});
function inventory(root, prefix = '') {
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(join(root, path));
    ensure(!stat.isSymbolicLink(), `Symlink in authenticated tree: ${path}`);
    if (stat.isDirectory()) return inventory(root, path);
    ensure(stat.isFile(), `Nonregular archive entry: ${path}`);
    const bytes = readFileSync(join(root, path));
    return [{ path, bytes: bytes.length, sha256: sha256(bytes) }];
  });
}
const identity = records => sha256(JSON.stringify(records));
ensure(textGit('rev-parse', '--show-toplevel') === repo, 'Unexpected Git root');
ensure(textGit('rev-parse', '--disambiguate=5137') === BASE, 'Ambiguous or changed accepted baseline');
ensure(textGit('cat-file', '-t', BASE) === 'commit', 'Baseline is not commit');
ensure(textGit('rev-parse', '--verify', `${FREEZE}^{commit}`) === FREEZE, 'Invalid freeze');
const directory = mkdtempSync(join(tmpdir(), 'xan-baseline-harness-20260828-'));
const receipt = { directory, base: BASE, freeze: FREEZE, started: new Date().toISOString(), commands: [], limitations: ['Not a full repository gate or independent acceptance run; no native oracle execution.', 'All baseline src/**/*.ts are included because the actual tsconfig.build.json includes them; no minimal dependency closure claim.', 'No public xan export/aggregate registration is added.', 'Integrity checks re-enumerate files, detecting additions as well as changes/deletions at checkpoints; not a concurrent mutation sandbox.'] };
const save = () => json(join(directory, 'receipt.json'), receipt);
function run(label, executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, LANG: 'C.UTF-8', XAN_PACKAGE_ROOT: join(directory, 'moved/node_modules/virtual-bash') } });
  writeFileSync(join(directory, `${label}.stdout.log`), result.stdout ?? '');
  writeFileSync(join(directory, `${label}.stderr.log`), result.stderr ?? '');
  const record = { label, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message ?? null };
  receipt.commands.push(record);
  save();
  return record.status === 0 && !record.error;
}
try {
  receipt.publicFreeze = Object.entries(PUBLIC_HASHES).map(([name, expected]) => {
    const path = PUBLIC + name;
    const bytes = git('show', `${FREEZE}:${path}`);
    ensure(sha256(bytes) === expected, `Public freeze hash mismatch: ${name}`);
    put(directory, `public/${name}`, bytes);
    return { path, revision: FREEZE, blob: textGit('rev-parse', `${FREEZE}:${path}`), sha256: expected, bytes: bytes.length };
  });
  const binding = JSON.parse(readFileSync(join(directory, 'public/FINAL-BINDING-V4.json')));
  receipt.contractBindings = binding.sourceBindings.filter(entry => entry.path.startsWith('src/contracts/')).map(entry => {
    const bytes = git('show', `${BASE}:${entry.path}`);
    ensure(sha256(bytes) === entry.sha256, `Baseline contract differs from freeze: ${entry.path}`);
    return { path: entry.path, baseBlob: textGit('rev-parse', `${BASE}:${entry.path}`), sha256: sha256(bytes), boundRevision: entry.revision };
  });
  const baseline = join(directory, 'baseline');
  const allSource = tree(BASE, 'src');
  const selected = [...allSource.filter(entry => entry.path.endsWith('.ts')), ...['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].flatMap(path => tree(BASE, path))].sort((left, right) => left.path < right.path ? -1 : 1);
  receipt.baselineManifest = exportEntries(BASE, selected, baseline);
  receipt.baselineIdentity = identity(receipt.baselineManifest);
  receipt.exclusions = { omittedSource: allSource.filter(entry => !entry.path.endsWith('.ts')), omittedRoots: ['tests', 'scripts', 'docs', 'benchmarks', '.git', 'node_modules', 'AGENTS.md', 'README.md', '.gitignore'], rule: 'Only the 211 baseline TypeScript build inputs and four exact package/config files; documents and data are not TypeScript build inputs. Missing dependencies remain build errors, never live-source fallback.' };
  const baselinePackage = JSON.parse(readFileSync(join(baseline, 'package.json')));
  receipt.package = { name: baselinePackage.name, version: baselinePackage.version, dependencies: baselinePackage.dependencies ?? {}, optionalDependencies: baselinePackage.optionalDependencies ?? {}, peerDependencies: baselinePackage.peerDependencies ?? {}, devDependencies: baselinePackage.devDependencies ?? {} };
  const tools = join(directory, 'tools/node_modules');
  const lock = JSON.parse(readFileSync(join(baseline, 'package-lock.json')));
  const pending = ['typescript', '@types/node', 'tsx'];
  const seen = new Set();
  receipt.toolPackages = [];
  while (pending.length) {
    const name = pending.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const source = join(repo, 'node_modules', name);
    ensure(realpathSync(source).startsWith(`${join(repo, 'node_modules')}${sep}`), `Tool outside existing dependency directory: ${name}`);
    const pkg = JSON.parse(readFileSync(join(source, 'package.json')));
    ensure(lock.packages[`node_modules/${name}`]?.version === pkg.version, `Installed tooling differs from baseline lock: ${name}`);
    cpSync(source, join(tools, name), { recursive: true, dereference: true });
    receipt.toolPackages.push({ name, version: pkg.version, source: realpathSync(source), lockIntegrity: lock.packages[`node_modules/${name}`]?.integrity ?? null });
    pending.push(...Object.keys(pkg.dependencies ?? {}));
    pending.push(...Object.keys(pkg.optionalDependencies ?? {}).filter(dependency => existsSync(join(repo, 'node_modules', dependency))));
  }
  receipt.toolManifest = inventory(join(directory, 'tools'));
  receipt.toolIdentity = identity(receipt.toolManifest);
  receipt.toolVersions = { node: process.version, nodeExecutable: process.execPath, nodeExecutableSha256: sha256(readFileSync(process.execPath)), platform: process.platform, arch: process.arch, git: textGit('--version'), npm: execFileSync('npm', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim(), tar: execFileSync('tar', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim() };
  for (const name of ['baseline', 'tools']) {
    ensure(run(`${name}-archive`, 'tar', ['-czf', join(directory, `${name}.tar.gz`), '-C', directory, name], directory), `Archive failed: ${name}`);
    receipt[`${name}Archive`] = { path: join(directory, `${name}.tar.gz`), sha256: sha256(readFileSync(join(directory, `${name}.tar.gz`))) };
  }
  const build = join(directory, 'build');
  cpSync(baseline, build, { recursive: true });
  cpSync(tools, join(build, 'node_modules'), { recursive: true });
  const compiler = join(directory, 'tools/node_modules/typescript/bin/tsc');
  receipt.baselineBuild = run('baseline-build', process.execPath, [compiler, '-p', 'tsconfig.build.json', '--pretty', 'false'], build);
  receipt.baselineTypecheck = run('baseline-typecheck', process.execPath, [compiler, '-p', 'tsconfig.build.json', '--noEmit', '--pretty', 'false'], build);
  receipt.baselineDiagnostics = receipt.baselineBuild && receipt.baselineTypecheck ? 'No baseline source/build diagnostics' : 'Pinned baseline failed before any candidate overlay; preserved logs are foreign baseline diagnostics, not candidate failures';
  if (options['--candidate']) {
    const candidate = options['--candidate'];
    ensure(/^[0-9a-f]{40}$/.test(candidate), 'Candidate must be an explicit full Git commit hash');
    ensure(textGit('rev-parse', '--verify', `${candidate}^{commit}`) === candidate, 'Candidate is not the requested commit');
    receipt.candidate = candidate;
    const auditFrom = options['--audit-from'] ?? `${candidate}^`;
    if (options['--audit-from']) ensure(/^[0-9a-f]{40}$/.test(auditFrom), 'Audit base must be full commit hash');
    const changed = git('diff', '--name-only', '-z', auditFrom, candidate, '--').toString().split('\0').filter(Boolean);
    receipt.candidateAudit = { from: textGit('rev-parse', auditFrom), changed, nonowned: changed.filter(path => !path.startsWith(MODULE) && !path.startsWith(CORE)), strict: Boolean(options['--audit-from']) };
    if (options['--audit-from']) ensure(receipt.candidateAudit.nonowned.length === 0, 'Strict candidate audit contains nonowned changes');
    const moduleEntries = tree(candidate, MODULE);
    const product = moduleEntries.filter(entry => entry.path.endsWith('.ts') && !entry.path.startsWith(`${MODULE}design-evidence/`));
    ensure(product.some(entry => entry.path === `${MODULE}index.ts`), 'Candidate module index.ts absent');
    ensure(product.every(entry => !entry.path.split('/').some(part => ['tests', 'fixtures'].includes(part)) && !entry.path.endsWith('.test.ts')), 'Nonproduct candidate overlay refused');
    receipt.candidateProduct = exportEntries(candidate, product, join(directory, 'candidate-overlay'));
    receipt.candidateDocs = exportEntries(candidate, moduleEntries.filter(entry => !product.includes(entry)), join(directory, 'evidence'));
    receipt.candidateTests = exportEntries(candidate, tree(candidate, CORE), join(directory, 'evidence'));
    const composed = join(directory, 'composed');
    cpSync(baseline, composed, { recursive: true });
    cpSync(join(directory, 'candidate-overlay'), composed, { recursive: true });
    const before = inventory(composed);
    receipt.compositionManifest = before;
    receipt.compositionIdentity = identity(before);
    cpSync(tools, join(composed, 'node_modules'), { recursive: true });
    receipt.candidateBuild = run('candidate-build', process.execPath, [compiler, '-p', 'tsconfig.build.json', '--pretty', 'false'], composed);
    receipt.candidateTypecheck = run('candidate-typecheck', process.execPath, [compiler, '-p', 'tsconfig.build.json', '--noEmit', '--pretty', 'false'], composed);
    const sourceAfter = inventory(composed).filter(entry => !entry.path.startsWith('node_modules/') && !entry.path.startsWith('dist/'));
    ensure(identity(before) === identity(sourceAfter), 'Composed inputs changed or gained entries during build');
    if (receipt.candidateBuild && receipt.candidateTypecheck) {
      const moved = join(directory, 'moved');
      const packaged = join(moved, 'node_modules/virtual-bash');
      mkdirSync(packaged, { recursive: true });
      cpSync(join(composed, 'dist'), join(packaged, 'dist'), { recursive: true });
      cpSync(join(baseline, 'package.json'), join(packaged, 'package.json'));
      ensure(!existsSync(join(packaged, 'src')), 'Moved package must have no source');
      const packedBefore = inventory(packaged);
      receipt.movedPackageManifest = packedBefore;
      receipt.movedPackageIdentity = identity(packedBefore);
      const factory = options['--factory'] ?? 'createXanCommand';
      ensure(/^[A-Za-z_$][\w$]*$/.test(factory), 'Invalid factory identifier');
      put(moved, 'package.json', '{"private":true,"type":"module"}\n');
      put(moved, 'consumer.ts', `import { ${factory} } from './node_modules/virtual-bash/dist/commands/xan/index.js';\nimport type { CommandDefinition } from './node_modules/virtual-bash/dist/contracts/command.js';\ntype Factory = typeof ${factory};\ntype FactoryArguments = Parameters<Factory>;\ntype FactoryResult = ReturnType<Factory>;\nexport const instantiate = (...args: FactoryArguments): CommandDefinition => ${factory}(...args);\nexport const definition: FactoryResult = ${factory}();\nexport const command: CommandDefinition = definition;\n`);
      put(moved, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, noEmit: true, types: ['node'], typeRoots: [join(directory, 'tools/node_modules/@types')] }, files: ['consumer.ts'] }));
      receipt.movedStrict = run('moved-strict', process.execPath, [compiler, '-p', 'tsconfig.json', '--pretty', 'false'], moved);
      put(moved, 'smoke.mjs', `import assert from 'node:assert/strict';\nimport { ${factory} } from './node_modules/virtual-bash/dist/commands/xan/index.js';\nconst command = ${factory}();\nassert.equal(command.name, 'xan');\nassert.equal(typeof command.execute, 'function');\nconsole.log('compiled internal factory smoke only; not semantic acceptance');\n`);
      receipt.movedSmoke = run('moved-smoke', process.execPath, ['smoke.mjs'], moved);
      if (options['--runtime-entry']) {
        const entry = options['--runtime-entry'];
        ensure(entry.startsWith(CORE) && !entry.split('/').includes('..') && /\.(mjs|js|ts)$/.test(entry), 'Runtime entry must be a committed author-core script');
        ensure(receipt.candidateTests.some(item => item.path === entry), 'Runtime entry not in candidate evidence');
        cpSync(join(directory, 'evidence', CORE), join(moved, CORE), { recursive: true });
        const tsx = join(directory, 'tools/node_modules/tsx/dist/loader.mjs');
        receipt.authorRuntime = run('author-runtime', process.execPath, ['--import', tsx, '--test', entry], moved);
      } else receipt.authorRuntime = 'NOT_RUN: supply --runtime-entry author-core path; script must address compiled package using XAN_PACKAGE_ROOT, never original src';
      ensure(identity(packedBefore) === identity(inventory(packaged)), 'Moved compiled package changed or gained entries');
    } else receipt.movedStrict = receipt.movedSmoke = 'NOT_RUN: candidate build/typecheck failed; emitted files not accepted';
  }
  ensure(identity(receipt.baselineManifest.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))) === identity(inventory(baseline)), 'Baseline archive inputs changed or gained entries');
  ensure(receipt.toolIdentity === identity(inventory(join(directory, 'tools'))), 'Tool archive inputs changed or gained entries');
  for (const name of ['baseline', 'tools']) ensure(receipt[`${name}Archive`].sha256 === sha256(readFileSync(join(directory, `${name}.tar.gz`))), 'Archive changed after execution');
  receipt.completed = new Date().toISOString();
  receipt.ok = receipt.baselineBuild && receipt.baselineTypecheck && (!receipt.candidate || (receipt.candidateBuild && receipt.candidateTypecheck && receipt.movedStrict === true && receipt.movedSmoke === true && receipt.authorRuntime !== false));
} catch (error) {
  receipt.failure = error.stack;
  receipt.ok = false;
} finally {
  save();
  console.log(JSON.stringify({ directory, receipt: join(directory, 'receipt.json'), base: BASE, candidate: receipt.candidate ?? null, baselineIdentity: receipt.baselineIdentity, baselineArchive: receipt.baselineArchive, ok: receipt.ok, failure: receipt.failure ?? null }, null, 2));
  process.exitCode = receipt.ok ? 0 : 1;
}
