import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  assert.ok(['--repository', '--output', '--npm-cli', '--mode'].includes(key), `Unknown option: ${key}`);
  assert.ok(process.argv[index + 1], `Missing value: ${key}`);
  assert.equal(options[key], undefined, `Duplicate option: ${key}`);
  options[key] = process.argv[index + 1];
}
assert.ok(options['--repository'] && options['--output'], 'Required: --repository REACHABLE_REPO --output NEW_SCRATCH_DIRECTORY');
const sourceRepository = realpathSync(options['--repository']);
const requestedOutput = resolve(options['--output']);
const output = join(realpathSync(dirname(requestedOutput)), requestedOutput.split(sep).at(-1));
const mode = options['--mode'] ?? 'build';
assert.ok(['build', 'objects'].includes(mode), 'mode must be build or objects');
const containment = relative(sourceRepository, output);
assert.ok(containment.startsWith(`..${sep}`) || isAbsolute(containment), 'Output must be outside the input repository');
mkdirSync(output);
mkdirSync(join(output, 'steps'));
mkdirSync(join(output, 'home'));
mkdirSync(join(output, 'temporary'));
writeFileSync(join(output, 'empty.npmrc'), '');
writeFileSync(join(output, 'empty-global.npmrc'), '');
const environment = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: join(output, 'home'), TMPDIR: join(output, 'temporary'),
  LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1',
  npm_config_cache: join(output, 'npm-cache'),
  npm_config_userconfig: join(output, 'empty.npmrc'),
  npm_config_globalconfig: join(output, 'empty-global.npmrc'),
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const identify = path => ({ path, bytes: lstatSync(path).size, sha256: hash(readFileSync(path)) });
const manifest = JSON.parse(readFileSync(join(here, 'MANIFEST.json')));
const report = {
  scope: 'Reachable-object reconstruction and exact package build only; no frozen runner or consumer execution',
  started: new Date().toISOString(), mode, status: 'RUNNING', sourceRepository, output,
  inputs: ['MANIFEST.json', 'candidate.commit.raw', 'reconstruct.mjs'].map(name => identify(join(here, name))),
  environment, platform: process.platform, architecture: process.arch, steps: [],
};
function run(name, binary, args, settings = {}) {
  const started = new Date().toISOString();
  const inputDescriptor = settings.stdinFile ? openSync(settings.stdinFile, 'r') : undefined;
  const outputDescriptor = settings.stdoutFile ? openSync(settings.stdoutFile, 'wx') : undefined;
  let result;
  try {
    result = spawnSync(binary, args, {
      cwd: settings.cwd ?? output, env: { ...environment, ...settings.environment },
      input: settings.input, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024,
      stdio: [inputDescriptor ?? 'pipe', outputDescriptor ?? 'pipe', 'pipe'],
    });
  } finally {
    if (inputDescriptor !== undefined) closeSync(inputDescriptor);
    if (outputDescriptor !== undefined) closeSync(outputDescriptor);
  }
  const row = {
    name, command: [binary, ...args], cwd: settings.cwd ?? output, started, finished: new Date().toISOString(),
    environmentOverrides: settings.environment ?? {}, status: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout, stderr: result.stderr,
    input: settings.input === undefined ? undefined : String(settings.input),
    stdinFile: settings.stdinFile ? identify(settings.stdinFile) : undefined,
    stdoutFile: settings.stdoutFile ? identify(settings.stdoutFile) : undefined,
  };
  report.steps.push(row);
  json(join(output, 'steps', `${String(report.steps.length).padStart(3, '0')}-${name}.json`), row);
  assert.equal(result.error, undefined, name);
  assert.equal(result.signal, null, name);
  assert.ok((settings.statuses ?? [0]).includes(result.status), `${name}: exit ${result.status}: ${result.stderr}`);
  return result.stdout?.trimEnd() ?? '';
}
function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, path);
    if (stat.isDirectory()) return inventory(path, `${prefix}${name}/`);
    assert.equal(stat.isFile(), true, path);
    return [{ path: `${prefix}${name}`, bytes: stat.size, sha256: hash(readFileSync(path)) }];
  });
}
function safeExtract(archive, destination, label) {
  const entries = run(`${label}-list`, '/usr/bin/tar', ['-tf', archive]).split('\n');
  assert.ok(entries.every(path => path && !path.startsWith('/') && !path.split('/').includes('..')));
  mkdirSync(destination, { recursive: true });
  run(`${label}-extract`, '/usr/bin/tar', ['-xf', archive, '-C', destination]);
  return inventory(destination);
}

try {
  const body = readFileSync(join(here, manifest.commitBody.file));
  assert.equal(body.length, 604);
  assert.equal(body.length, manifest.commitBody.bytes);
  assert.equal(hash(body), manifest.commitBody.sha256, 'Raw commit body SHA-256');
  assert.equal(createHash('sha1').update(Buffer.from(`commit ${body.length}\0`)).update(body).digest('hex'), manifest.candidate);
  const headers = body.toString('utf8').split('\n\n')[0].split('\n');
  assert.deepEqual(headers.filter(line => line.startsWith('tree ')), [`tree ${manifest.tree}`]);
  assert.deepEqual(headers.filter(line => line.startsWith('parent ')), [`parent ${manifest.parent}`]);
  assert.equal(manifest.bindings.length, 14);
  assert.equal(new Set(manifest.bindings.map(binding => binding.path)).size, 14);
  const repository = join(output, 'repository');
  const git = (name, args, settings = {}) => run(name, '/usr/bin/git', ['-C', repository, ...args], settings);
  run('git-version', '/usr/bin/git', ['--version']);
  run('tar-version', '/usr/bin/tar', ['--version']);
  report.tools = { node: { ...identify(realpathSync(process.execPath)), version: process.version }, git: identify('/usr/bin/git'), tar: identify('/usr/bin/tar') };
  run('reachable-anchor', '/usr/bin/git', ['-C', sourceRepository, 'cat-file', '-t', manifest.reachableAnchor]);
  const transfer = join(output, 'reachable.pack');
  run('export-reachable-only', '/usr/bin/git', ['-C', sourceRepository, 'pack-objects', '--stdout', '--revs'], {
    input: `${manifest.reachableAnchor}\n`, stdoutFile: transfer,
  });
  run('initialize-isolated-repository', '/usr/bin/git', ['init', '--template=', '--initial-branch=unborn', repository]);
  git('import-reachable-only', ['index-pack', '--stdin'], { stdinFile: transfer });
  const objectDirectory = realpathSync(join(repository, '.git/objects'));
  assert.equal(existsSync(join(objectDirectory, 'info/alternates')), false);
  assert.equal(existsSync(join(objectDirectory, 'info/http-alternates')), false);
  assert.equal(existsSync(join(repository, '.git/shallow')), false);
  assert.equal(git('no-created-refs-before', ['for-each-ref']), '');
  assert.equal(git('owned-object-directory', ['rev-parse', '--git-path', 'objects']), '.git/objects');
  const objectFiles = inventory(objectDirectory);
  assert.ok(objectFiles.every(file => lstatSync(join(objectDirectory, file.path)).nlink === 1), 'No shared hardlinked object files');
  git('candidate-absent-before', ['cat-file', '-e', `${manifest.candidate}^{commit}`], { statuses: [128] });
  git('reachable-closure-integrity', ['fsck', '--full', '--no-reflogs', manifest.reachableAnchor]);
  report.isolation = { objectDirectory, alternates: false, httpAlternates: false, shallow: false, hardlinks: false, refs: [], candidateAbsentBefore: true, transfer: identify(transfer) };
  const anchors = [...new Set([manifest.parent, manifest.productionAuthor, manifest.fixtureAuthor, manifest.authorEvidence, manifest.authorLedger, manifest.frozenFixture])];
  for (const [index, commit] of anchors.entries()) {
    git(`anchor-${index}-type`, ['cat-file', '-t', commit]);
    git(`anchor-${index}-ancestry`, ['merge-base', '--is-ancestor', commit, manifest.reachableAnchor]);
  }
  const indexPath = join(output, 'reconstruction.index');
  const indexEnvironment = { GIT_INDEX_FILE: indexPath };
  git('read-accepted-base', ['read-tree', manifest.parent], { environment: indexEnvironment });
  for (const [index, binding] of manifest.bindings.entries()) {
    assert.equal(binding.mode, '100644');
    assert.ok([manifest.productionAuthor, manifest.fixtureAuthor].includes(binding.sourceCommit));
    const entry = git(`binding-${index}-source`, ['ls-tree', binding.sourceCommit, '--', binding.path]);
    assert.equal(entry, `${binding.mode} blob ${binding.blob}\t${binding.path}`);
    const blobFile = join(output, `binding-${index}.blob`);
    git(`binding-${index}-bytes`, ['cat-file', 'blob', binding.blob], { stdoutFile: blobFile });
    assert.equal(hash(readFileSync(blobFile)), binding.sha256);
    git(`binding-${index}-index`, ['update-index', '--add', '--cacheinfo', `${binding.mode},${binding.blob},${binding.path}`], { environment: indexEnvironment });
  }
  const tree = git('write-reconstructed-tree', ['write-tree'], { environment: indexEnvironment });
  assert.equal(tree, manifest.tree, 'Exact tree before commit import');
  const changed = git('exact-fourteen-paths', ['diff-tree', '--no-commit-id', '--name-only', '-r', manifest.parent, tree]).split('\n');
  assert.deepEqual(changed, manifest.bindings.map(binding => binding.path));
  const commit = git('write-exact-commit-body', ['hash-object', '-t', 'commit', '-w', '--stdin'], { input: body });
  assert.equal(commit, manifest.candidate);
  git('candidate-present-after', ['cat-file', '-e', `${commit}^{commit}`]);
  const reconstructedBody = join(output, 'reconstructed.commit.raw');
  git('read-reconstructed-commit', ['cat-file', 'commit', commit], { stdoutFile: reconstructedBody });
  assert.deepEqual(readFileSync(reconstructedBody), body);
  assert.equal(git('candidate-tree-after', ['rev-parse', `${commit}^{tree}`]), tree);
  git('complete-reconstructed-integrity', ['fsck', '--full', '--no-reflogs', manifest.reachableAnchor, commit]);
  assert.equal(git('no-created-refs-after', ['for-each-ref']), '');
  report.reconstruction = { candidate: commit, tree, parent: manifest.parent, body: identify(reconstructedBody), changed, candidatePresentAfter: true, missingObjects: [], refs: [] };
  if (mode === 'build') {
    assert.equal(process.version, manifest.toolchain.nodeVersion, 'Pinned Node version');
    assert.equal(report.tools.node.sha256, manifest.toolchain.nodeSha256, 'Measured Node executable; other platforms are not this profile');
    const npmCli = realpathSync(options['--npm-cli'] ?? join(dirname(process.execPath), 'npm'));
    report.tools.npm = identify(npmCli);
    assert.equal(run('npm-version', process.execPath, [npmCli, '--version']), manifest.toolchain.npmVersion);
    const captureManifestFile = join(output, 'capture-manifest.json');
    git('read-capture-manifest', ['show', `${manifest.reachableAnchor}:${manifest.capture.directory}/RAW-MANIFEST.json`], { stdoutFile: captureManifestFile });
    const captureManifest = JSON.parse(readFileSync(captureManifestFile));
    const encodedFile = join(output, 'capture.tar.gz.b64');
    git('read-reachable-capture', ['show', `${manifest.reachableAnchor}:${manifest.capture.directory}/raw-results.tar.gz.b64`], { stdoutFile: encodedFile });
    const bytes = Buffer.from(readFileSync(encodedFile, 'utf8'), 'base64');
    assert.equal(bytes.length, manifest.capture.bytes);
    assert.equal(hash(bytes), manifest.capture.sha256);
    const captureArchive = join(output, 'capture.tar.gz');
    writeFileSync(captureArchive, bytes, { flag: 'wx' });
    const capture = join(output, 'capture');
    const capturedFiles = safeExtract(captureArchive, capture, 'capture');
    assert.equal(capturedFiles.length, manifest.capture.files);
    assert.deepEqual(capturedFiles.sort((first, second) => first.path.localeCompare(second.path)), captureManifest.files);
    report.capture = { archive: identify(captureArchive), files: capturedFiles.length, authenticated: true };
    const sourceArchive = join(output, 'reconstructed-source.tar');
    git('archive-reconstructed-source', ['archive', '--format=tar', commit, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md'], { stdoutFile: sourceArchive });
    assert.equal(hash(readFileSync(sourceArchive)), manifest.sourceArchiveSha256);
    assert.deepEqual(readFileSync(sourceArchive), readFileSync(join(capture, 'exact/source.tar')));
    run('extract-reconstructed-source', '/usr/bin/tar', ['-xf', sourceArchive, '-C', repository]);
    const sourceFiles = ['README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
    const sourceInventory = () => [...sourceFiles.map(path => ({ ...identify(join(repository, path)), path })), ...inventory(join(repository, 'src'), 'src/')];
    const before = sourceInventory();
    json(join(output, 'source-before.json'), before);
    run('install-pinned-lock', process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: repository });
    for (const tool of manifest.toolchain.files) assert.equal(hash(readFileSync(join(repository, 'node_modules', tool.path))), tool.sha256, tool.path);
    const compiler = join(repository, 'node_modules/typescript/bin/tsc');
    assert.equal(run('compiler-version', process.execPath, [compiler, '--version']), `Version ${manifest.toolchain.typescriptVersion}`);
    const exactReport = JSON.parse(readFileSync(join(capture, 'review/exact-artifact-report.json')));
    const dependencies = {};
    for (const [name, path] of [['typescript', 'typescript'], ['node', '@types/node'], ['undici', 'undici-types']]) {
      dependencies[name] = inventory(join(repository, 'node_modules', path));
      if (exactReport.typeDependencies[name]) assert.deepEqual(Object.fromEntries(dependencies[name].map(file => [file.path, file.sha256])), exactReport.typeDependencies[name]);
    }
    json(join(output, 'dependency-inventory.json'), dependencies);
    run('dependency-tree', process.execPath, [npmCli, 'ls', '--all', '--json'], { cwd: repository });
    run('build-exact-source', process.execPath, [compiler, '-p', 'tsconfig.build.json'], { cwd: repository });
    const destination = join(output, 'package');
    mkdirSync(destination);
    const packed = JSON.parse(run('pack-exact-build', process.execPath, [npmCli, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: repository }))[0];
    const pack = identify(join(destination, packed.filename));
    assert.equal(pack.sha256, manifest.acceptedPackSha256);
    assert.deepEqual(readFileSync(pack.path), readFileSync(join(capture, 'exact/virtual-bash-0.0.0.tgz')));
    assert.deepEqual(sourceInventory(), before);
    json(join(output, 'dist-inventory.json'), inventory(join(repository, 'dist')));
    report.build = { sourceArchive: identify(sourceArchive), pack, entries: packed.entryCount, sourceUnchanged: true, dependencyInstall: 'npm ci using reconstructed lock; isolated empty cache; scripts disabled; no live node_modules', compiler: identify(compiler) };
    const prefix = 'tests/integration/aliases-column-public-independent-20260827';
    run('restore-frozen-inputs-without-execution', '/usr/bin/tar', ['-xf', join(capture, 'frozen/fixtures.tar'), '-C', repository]);
    const authentication = JSON.parse(readFileSync(join(capture, 'review/authentication.json')));
    const fixtureFiles = inventory(join(repository, prefix));
    assert.equal(fixtureFiles.length, 11);
    assert.deepEqual(Object.fromEntries(fixtureFiles.map(file => [file.path, file.sha256])), authentication.fixtureBefore);
    const replay = join(output, 'external-replay');
    const frozen = join(output, 'frozen-inputs');
    mkdirSync(replay);
    mkdirSync(frozen);
    cpSync(join(capture, 'frozen/report.json'), join(frozen, 'report.json'));
    cpSync(join(capture, 'frozen/consumer-inputs'), join(frozen, 'consumer-moved'), { recursive: true });
    cpSync(join(capture, 'review/declaration.json'), join(replay, 'declaration.json'));
    cpSync(join(capture, 'review/supplemental.mjs'), join(replay, 'supplemental.mjs'));
    mkdirSync(join(replay, 'author-raw/package'), { recursive: true });
    cpSync(join(capture, 'exact/virtual-bash-0.0.0.tgz'), join(replay, 'author-raw/package/virtual-bash-0.0.0.tgz'));
    const original = readFileSync(join(capture, 'review/exact-artifact-review.mjs'), 'utf8');
    let relocated = original;
    const edits = [];
    for (const [name, path] of [['output', replay], ['repository', repository], ['frozen', frozen]]) {
      const pattern = new RegExp(`^const ${name}='[^'\\n]+';$`, 'gm');
      const matches = [...original.matchAll(pattern)];
      assert.equal(matches.length, 1, `Exactly one location declaration: ${name}`);
      const replacement = `const ${name}=${JSON.stringify(path)};`;
      relocated = relocated.replace(pattern, () => replacement);
      edits.push({ original: matches[0][0], replacement });
    }
    const revert = edits.reduce((text, edit) => text.replace(edit.replacement, edit.original), relocated);
    assert.equal(revert, original, 'Only three scratch path declarations changed');
    const adapter = join(replay, 'exact-artifact-review.relocated.mjs');
    writeFileSync(adapter, relocated, { flag: 'wx' });
    run('check-relocated-harness-syntax', process.execPath, ['--check', adapter]);
    run('check-unchanged-supplemental-syntax', process.execPath, ['--check', join(replay, 'supplemental.mjs')]);
    report.relocation = { adapter: identify(adapter), originalSha256: hash(Buffer.from(original)), edits, reverseEditsRestoreOriginalBytes: true, frozenFilesUnchanged: 11, supplementalUnchanged: true, consumersExecuted: false, optionalCommand: [process.execPath, adapter], scope: 'Only external exact harness scratch declarations changed; original frozen runner is never executed or edited' };
    json(join(output, 'relocation.json'), report.relocation);
  }
  report.status = mode === 'build' ? 'PASS reconstructed exact commit/tree/source archive/package; external replay materialized, not executed' : 'PASS isolated object reconstruction only';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  json(join(output, 'REPORT.json'), report);
  console.log(JSON.stringify({ status: report.status, output, reconstruction: report.reconstruction, build: report.build, error: report.error }));
}
