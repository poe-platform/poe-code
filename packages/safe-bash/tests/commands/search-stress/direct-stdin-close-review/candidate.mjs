import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, '../../../..');
const prefix = relative(root, own);
const candidate = 'c27249c8f6085d6d8366ae348b2b93aa0e377369';
const authorEvidence = '8a08ecc026a2d0884508d4115acb909b22251199';
const baseline = 'c5d44262ecca11009df6ce32a180005d3f3cb574';
const originalFreeze = '3152f33005fbd6b85053a5c5990ce42011e663b1';
const preparationFreeze = 'fc19be6ceac27828d22472e78ca0a86041618363';
const baselineEvidence = '32d2f7dc1d8438338d2b7bf070041b3302c0a668';
const work = '/tmp/rg-direct-close-candidate-independent-01';
const report = join(own, 'runs/candidate-01');
const findings = '/tmp/rg-direct-close-candidate-independent-findings.txt';
const phase = process.argv[2];
assert.ok(['prepare', 'replay'].includes(phase), 'explicit prepare or replay phase required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (name, value) => writeFileSync(join(report, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const commands = [];
function command(argv, cwd = root) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  commands.push({ argv, cwd, pid: result.pid, status: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, `command failed: ${JSON.stringify(argv)}`);
  return result.stdout;
}
function gitBytes(commit, path) {
  const result = spawnSync('git', ['show', `${commit}:${path}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `Git object unavailable: ${commit}:${path}`);
  return result.stdout;
}
function inventory(directory) {
  const entries = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = join(path, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) {
        const bytes = readFileSync(filename);
        entries.push({ path: relative(directory, filename), bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  visit(directory);
  return entries;
}
function authenticate(commit, path) {
  const bytes = gitBytes(commit, `${prefix}/${path}`);
  assert.deepEqual(readFileSync(join(own, path)), bytes, `historical bytes changed: ${path}`);
  return { commit, path, sha256: hash(bytes) };
}
function absent(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  try { process.kill(pid, 0); return false; } catch (error) { if (error.code !== 'ESRCH') throw error; return true; }
}
function tools() {
  const compiler = realpathSync(join(root, 'node_modules/typescript/bin/tsc'));
  const npm = realpathSync(join(dirname(process.execPath), 'npm'));
  return {
    node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) },
    compiler: { path: compiler, version: read(join(root, 'node_modules/typescript/package.json')).version, sha256: hash(readFileSync(compiler)) },
    npm: { path: npm, sha256: hash(readFileSync(npm)) },
    tar: { path: '/usr/bin/tar', sha256: hash(readFileSync('/usr/bin/tar')) },
    compilerPackage: inventory(join(root, 'node_modules/typescript')),
    nodeTypes: inventory(join(root, 'node_modules/@types/node')),
    undiciTypes: inventory(join(root, 'node_modules/undici-types')),
  };
}
function verifyBinding(binding) {
  assert.equal(hash(readFileSync(fileURLToPath(import.meta.url))), binding.runner.sha256);
  assert.deepEqual(tools(), binding.tools);
  for (const entry of binding.historical) assert.equal(hash(readFileSync(join(own, entry.path))), entry.sha256, entry.path);
  for (const entry of binding.sourceBefore) assert.equal(hash(readFileSync(join(binding.move.quarantine, entry.path))), entry.sha256, entry.path);
  assert.deepEqual(inventory(join(binding.move.to, 'node_modules/virtual-bash')), binding.packedInventory);
  assert.equal(hash(readFileSync(join(report, 'virtual-bash-candidate.tgz'))), binding.tarball.sha256);
  assert.equal(hash(readFileSync(join(binding.move.to, 'cases.mjs'))), binding.fixture.preparedSha256);
  assert.equal(hash(readFileSync(join(report, 'prepared-cases.mjs.data'))), binding.fixture.preparedSha256);
  assert.equal(hash(readFileSync(join(binding.move.to, 'consumer.mjs'))), binding.consumer.sha256);
}

mkdirSync(report, { recursive: true });
try {
  if (phase === 'prepare') {
    write('started.json', { candidate, authorEvidence, baseline, started: new Date().toISOString(), ownership: prefix, work });
    assert.equal(existsSync(work), false);
    mkdirSync(work);
    const observedStatus = command(['git', 'status', '--short']);
    const observedIndex = command(['git', 'diff', '--cached', '--name-only']);
    assert.equal(command(['git', 'rev-parse', `${candidate}^{commit}`]).trim(), candidate);
    assert.equal(command(['git', 'rev-parse', `${authorEvidence}^{commit}`]).trim(), authorEvidence);
    const routedCommitPaths = command(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', candidate]).trim().split('\n');
    assert.deepEqual(routedCommitPaths, ['src/commands/search/rg.ts', 'tests/commands/search-stress/direct-stdin-close.test.ts']);
    const historicalPaths = command(['git', 'ls-tree', '-r', '--name-only', baselineEvidence, '--', prefix]).trim().split('\n');
    const historical = historicalPaths.map(path => authenticate(baselineEvidence, relative(prefix, path)));
    for (const path of ['FROZEN.md', 'cases.mjs', 'consumer.mjs', 'baseline-provenance.json']) authenticate(originalFreeze, path);
    for (const path of ['prepare.mjs', 'prepare-fixture.mjs', 'prepare-fixture-v2.mjs', 'seal.mjs']) authenticate(preparationFreeze, path);
    const frozen = gitBytes(originalFreeze, `${prefix}/cases.mjs`);
    const consumer = gitBytes(originalFreeze, `${prefix}/consumer.mjs`);
    const prepared = gitBytes(baselineEvidence, `${prefix}/runs/baseline-03/prepared-cases.mjs.data`);
    const { prepareFixture } = await import('./prepare-fixture-v2.mjs');
    const fixture = prepareFixture(frozen.toString('utf8'));
    assert.deepEqual(Buffer.from(fixture.prepared), prepared);
    assert.equal(hash(prepared), '7c2878680b994f4b66ba3d564efe17c0f60a122667da83ed62fe4285f6e146e0');
    assert.equal(fixture.evidence.assertionsSha256, '6d3bb10685c8f3bc94273c007da8c620b98bde933517c2d02111a8ced78d36cc');
    assert.equal(hash(consumer), 'f0c7c93eecc99c3213665a221c53b89536e90e6f7ac6aef6d84914a979879c59');
    const provenance = JSON.parse(gitBytes(originalFreeze, `${prefix}/baseline-provenance.json`));
    const buildInputs = provenance.files.filter(entry => entry.kind === 'build-input');
    const trackedTypeScript = command(['git', 'ls-tree', '-r', '--name-only', candidate, '--', 'src']).trim().split('\n').filter(path => path.endsWith('.ts'));
    assert.deepEqual(trackedTypeScript.sort(), buildInputs.map(entry => entry.path).filter(path => path.startsWith('src/')).sort());
    const delta = command(['git', 'diff', baseline, candidate, '--', ...buildInputs.map(entry => entry.path)]);
    writeFileSync(join(report, 'source.patch-data'), delta, { flag: 'wx' });
    const source = join(work, 'source');
    mkdirSync(source);
    const sourceBefore = buildInputs.map(entry => {
      const bytes = gitBytes(candidate, entry.path);
      assert.equal(hash(gitBytes(baseline, entry.path)), entry.sha256);
      if (entry.path !== 'src/commands/search/rg.ts') assert.equal(hash(bytes), entry.sha256, `unexpected build-input change: ${entry.path}`);
      const path = join(source, entry.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes, { flag: 'wx' });
      return { path: entry.path, bytes: bytes.length, sha256: hash(bytes), baselineSha256: entry.sha256 };
    });
    assert.equal(sourceBefore.find(entry => entry.path === 'src/commands/search/rg.ts').sha256, '1c38e14b811a46795af958a99b9fae6b02b415b6ff8363e5755ecd15bfdd9d5f');
    symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
    const toolInputs = tools();
    assert.equal(toolInputs.node.version, 'v22.22.2');
    assert.equal(toolInputs.compiler.version, '5.9.3');
    command([process.execPath, toolInputs.compiler.path, '-p', 'tsconfig.build.json'], source);
    const built = inventory(join(source, 'dist'));
    const packs = join(work, 'packs');
    mkdirSync(packs);
    command([process.execPath, toolInputs.npm.path, 'pack', '--ignore-scripts', '--offline', '--cache', join(work, 'npm-cache'), '--pack-destination', packs, '--json'], source);
    const packNames = readdirSync(packs).filter(name => name.endsWith('.tgz'));
    assert.equal(packNames.length, 1);
    const tarball = join(packs, packNames[0]);
    const staged = join(work, 'staged-consumer');
    const packagePath = join(staged, 'node_modules/virtual-bash');
    mkdirSync(packagePath, { recursive: true });
    command([toolInputs.tar.path, '-xzf', tarball, '--strip-components=1', '-C', packagePath]);
    writeFileSync(join(staged, 'consumer.mjs'), consumer, { flag: 'wx' });
    writeFileSync(join(staged, 'cases.mjs'), prepared, { flag: 'wx' });
    writeFileSync(join(report, 'prepared-cases.mjs.data'), prepared, { flag: 'wx' });
    writeFileSync(join(staged, 'package.json'), '{"type":"module","private":true}\n', { flag: 'wx' });
    const moved = join(work, 'moved-consumer');
    renameSync(staged, moved);
    const quarantine = join(work, 'quarantined-source');
    renameSync(source, quarantine);
    const packedInventory = inventory(join(moved, 'node_modules/virtual-bash'));
    for (const entry of built) assert.equal(packedInventory.find(actual => actual.path === `dist/${entry.path}`)?.sha256, entry.sha256);
    const packageBytes = readFileSync(tarball);
    writeFileSync(join(report, 'virtual-bash-candidate.tgz'), packageBytes, { flag: 'wx' });
    const { caseNames } = await import('./cases.mjs');
    const binding = { candidate, authorEvidence, baseline, originalFreeze, preparationFreeze, baselineEvidence,
      runner: { path: relative(root, fileURLToPath(import.meta.url)), sha256: hash(readFileSync(fileURLToPath(import.meta.url))) },
      historical, fixture: fixture.evidence, consumer: { sha256: hash(consumer) }, tools: toolInputs, sourceBefore, built, packedInventory,
      tarball: { path: tarball, bytes: packageBytes.length, sha256: hash(packageBytes) },
      move: { from: staged, to: moved, originalBuildRoot: source, quarantine },
      observedStatus, observedIndex, observedHeadNotCandidate: command(['git', 'rev-parse', 'HEAD']).trim(), routedCommitPaths,
      authorMarker: readFileSync('/tmp/safe-bash-search-stdin-close-fix.ready', 'utf8'), caseNames,
      execution: { childTimeoutMs: 30000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, execArgv: ['--unhandled-rejections=strict'], repetitions: 1 },
      frozenAt: new Date().toISOString(), scope: 'Exact prepared-v2 independent cohort only; no author or historical whole-gate acceptance' };
    verifyBinding(binding);
    write('execution-binding.json', binding);
    console.log(JSON.stringify({ phase, candidate, buildInputs: sourceBefore.length, packedFiles: packedInventory.length, fixture: hash(prepared), package: hash(packageBytes) }));
  } else {
    const binding = read(join(report, 'execution-binding.json'));
    verifyBinding(binding);
    const freezeCommit = command(['git', 'log', '-1', '--format=%H', '--', relative(root, join(report, 'execution-binding.json'))]).trim();
    assert.ok(freezeCommit);
    assert.deepEqual(gitBytes(freezeCommit, relative(root, join(report, 'execution-binding.json'))), readFileSync(join(report, 'execution-binding.json')));
    assert.deepEqual(gitBytes(freezeCommit, relative(root, fileURLToPath(import.meta.url))), readFileSync(fileURLToPath(import.meta.url)));
    write('replay-started.json', { candidate, freezeCommit, bindingSha256: hash(readFileSync(join(report, 'execution-binding.json'))), started: new Date().toISOString() });
    const results = [];
    for (const name of binding.caseNames) {
      const argv = [process.execPath, ...binding.execution.execArgv, join(binding.move.to, 'consumer.mjs'), name];
      const started = Date.now();
      const result = spawnSync(argv[0], argv.slice(1), { cwd: binding.move.to, encoding: 'utf8', timeout: binding.execution.childTimeoutMs,
        killSignal: binding.execution.killSignal, maxBuffer: binding.execution.maxBuffer });
      writeFileSync(join(report, `${name}.stdout.data`), result.stdout ?? '', { flag: 'wx' });
      writeFileSync(join(report, `${name}.stderr.data`), result.stderr ?? '', { flag: 'wx' });
      let outcome;
      try { outcome = JSON.parse(result.stdout); } catch {}
      const run = { name, argv, cwd: binding.move.to, elapsedMs: Date.now() - started, pid: result.pid, status: result.status, signal: result.signal,
        error: result.error?.message, naturalExit: result.status !== null && !result.signal && !result.error,
        pass: result.status === 0 && outcome?.pass === true,
        failures: outcome?.checks.filter(check => !check.pass).map(check => check.identity) ?? ['no-json-outcome'], outcome };
      write(`${name}.json`, run);
      results.push(run);
      console.log(`${run.pass ? 'PASS' : 'FAIL'} ${name}: ${run.failures.join(', ')}`);
      if (!run.pass) writeFileSync(findings, `INDEPENDENT CANDIDATE FAILURE ${candidate}\n${name}: ${run.failures.join(', ')}\nNo product changes authorized. Raw outcome: ${report}/${name}.json\n`);
    }
    verifyBinding(binding);
    const packageRoot = join(binding.move.to, 'node_modules/virtual-bash');
    const expected = new Map(binding.packedInventory.map(entry => [entry.path, entry.sha256]));
    const transitions = [];
    const checks = [];
    let assertionCount = 0;
    let failedAssertions = 0;
    let workerCount = 0;
    for (const run of results) {
      assert.equal(run.naturalExit, true, run.name);
      const outcome = run.outcome;
      assert.equal(outcome.authentication.packageModulesOnly, true);
      assert.equal(outcome.authentication.workerAssetsMoved, true);
      assert.ok(outcome.authentication.modules.length > 0);
      const loadedAfter = [...outcome.authentication.modules, ...outcome.authentication.workerEvents].map(loaded => {
        const path = relative(packageRoot, fileURLToPath(loaded.url));
        assert.equal(loaded.sha256, expected.get(path));
        const sha256 = hash(readFileSync(join(packageRoot, path)));
        assert.equal(sha256, loaded.sha256);
        return { path, before: expected.get(path), loaded: loaded.sha256, after: sha256 };
      });
      for (const worker of outcome.authentication.workerEvents) {
        assert.equal(worker.exited, true);
        assert.deepEqual(worker.options, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
      }
      const zeroWorkerControl = ['already-aborted-zero-active-workers', 'invalid-zero-maxworkers'].includes(run.name);
      assert.equal(outcome.authentication.workerEvents.length, zeroWorkerControl ? 0 : 1);
      workerCount += outcome.authentication.workerEvents.length;
      assertionCount += outcome.checks.length;
      failedAssertions += outcome.checks.filter(check => !check.pass).length;
      assert.equal(outcome.checks.find(check => check.identity === 'zero-live-workers-after-cleanup').actual, 0);
      for (const state of outcome.observations.afterFixtureCleanup) assert.equal(state.closed ?? state.finalized, true);
      assert.equal(absent(run.pid), true, `owned child PID still exists: ${run.pid}`);
      const prior = read(join(own, 'runs/baseline-03', `${run.name}.json`));
      assert.deepEqual(outcome.checks.map(check => [check.identity, check.expected]), prior.outcome.checks.map(check => [check.identity, check.expected]));
      transitions.push({ name: run.name, before: prior.pass, after: run.pass, checks: outcome.checks.map((check, index) => ({
        identity: check.identity, before: prior.outcome.checks[index].pass, after: check.pass,
        beforeActual: prior.outcome.checks[index].actual, afterActual: check.actual, expected: check.expected })) });
      checks.push({ name: run.name, childPid: run.pid, childAbsent: true, fixtureResourcesClosed: true, workers: outcome.authentication.workerEvents.length, loadedAfter });
    }
    const workerGraph = [];
    const seen = new Set();
    function visit(path) {
      if (seen.has(path)) return;
      seen.add(path);
      const bytes = readFileSync(join(packageRoot, path));
      const text = bytes.toString('utf8');
      assert.equal(/\bimport\s*\(/u.test(text), false, `unexpected dynamic worker import: ${path}`);
      const imports = [...text.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map(match => match[1]);
      workerGraph.push({ path, sha256: hash(bytes), imports });
      for (const specifier of imports) if (specifier.startsWith('.')) visit(relative(packageRoot, resolve(packageRoot, dirname(path), specifier)));
    }
    visit('dist/commands/regex-execution/worker.js');
    write('transitions.json', transitions);
    write('seal.json', { candidate, baseline, freezeCommit, total: results.length, passed: results.filter(run => run.pass).length,
      failed: results.filter(run => !run.pass).length, assertionCount, failedAssertions, workerCount, zeroWorkerControls: 2, checks, workerGraph,
      sourceAfter: binding.sourceBefore.map(entry => ({ path: entry.path, sha256: hash(readFileSync(join(binding.move.quarantine, entry.path))) })),
      sourceAndConfigUnchanged: true, packedAssetsUnchanged: true, toolsUnchanged: true, historicalEvidenceUnchanged: true,
      preparedFixtureUnchanged: true, allChildrenNaturalExit: true, sealedAt: new Date().toISOString(),
      scope: 'Exact unchanged prepared-v2 cohort only; not whole-gate acceptance, opaque hard preemption or author-suite acceptance' });
    const commandPids = [...read(join(report, 'prepare-commands.json')), ...commands].map(entry => ({ pid: entry.pid, absent: absent(entry.pid) }));
    assert.ok(commandPids.every(entry => entry.absent));
    assert.equal(work, '/tmp/rg-direct-close-candidate-independent-01');
    rmSync(work, { recursive: true });
    assert.equal(existsSync(work), false);
    write('cleanup.json', { commandPids, childPids: results.map(run => ({ pid: run.pid, absent: absent(run.pid) })), liveWorkers: 0,
      scratch: work, scratchAbsent: true, cleanedAt: new Date().toISOString() });
    console.log(JSON.stringify({ total: results.length, passed: results.filter(run => run.pass).length, assertionCount, failedAssertions, workerCount, scratchAbsent: true }));
    if (results.some(run => !run.pass)) process.exitCode = 1;
  }
} catch (error) {
  write(`${phase}-error.json`, { message: error.message, stack: error.stack });
  writeFileSync(findings, `INDEPENDENT ${phase.toUpperCase()} BLOCKER\n${error.stack}\nNo product edits.\n`);
  console.error(error);
  process.exitCode = 1;
} finally {
  write(`${phase}-commands.json`, commands);
}
