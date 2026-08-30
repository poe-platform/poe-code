import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { arch, release, type } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const base = resolve(root, 'tests/commands/expr-stress/frozen');
const baseline = 'b67eabd289997b2daf8b9cf04dd48aea9cb48282';
const original = 'evidence/original-20260827';
const originalManifest = join(base, original, 'manifest.json');
const limits = { timeoutMs: 2000, combinedOutputBytes: 65536, argumentBytes: 8192, argumentCount: 128 };
const pins = {
  gnu: { path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr', sha256: 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c' },
  apple: { path: '/bin/expr', sha256: '584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f' },
  archive: { path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz', sha256: 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf' },
  source: { path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr.c', sha256: 'c9dc5e04039505ab48a350e9407b1d83b2574fd7e2c31c9d23f4bf942d1b8af0' }
};
const environment = locale => ({ PATH: '/usr/bin:/bin', LC_ALL: locale, LANG: locale, LANGUAGE: 'C', TZ: 'UTC' });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const caseSha256 = entry => sha256(JSON.stringify(entry));
const inputs = load(join(base, 'inputs.json'));
const children = new Set();
let interrupted = false;
const interrupt = () => { interrupted = true; for (const child of children) child.kill('SIGKILL'); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

function validateInputs() {
  assert.equal(inputs.schema, 1);
  assert(inputs.cases.length > 0 && inputs.cases.length <= 110);
  assert.equal(new Set(inputs.cases.map(entry => entry.id)).size, inputs.cases.length);
  for (const entry of inputs.cases) {
    assert.equal(typeof entry.id, 'string');
    assert(entry.argv.every(value => typeof value === 'string' && value.isWellFormed() && !value.includes('\0')));
    assert(entry.argv.length <= limits.argumentCount);
    assert(entry.argv.reduce((bytes, value) => bytes + Buffer.byteLength(value) + 1, 0) <= limits.argumentBytes);
  }
}

async function native(path, args, env, cwd, argv0 = 'expr') {
  assert(!interrupted, 'capture interrupted');
  return await new Promise((resolveResult, rejectResult) => {
    const child = spawn(path, args, { cwd, env, argv0, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let failure;
    const timer = setTimeout(() => { failure = 'timeout'; child.kill('SIGKILL'); }, limits.timeoutMs);
    const collect = target => chunk => {
      outputBytes += chunk.length;
      if (outputBytes > limits.combinedOutputBytes) {
        failure = 'output-limit';
        child.kill('SIGKILL');
      } else target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', error => { failure = `spawn-error: ${error.message}`; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      children.delete(child);
      if (interrupted) return rejectResult(new Error('capture interrupted; child reaped'));
      resolveResult({ status, signal, failure: failure ?? null, stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64') });
    });
  });
}

function boundedHelper(path, args, cwd, maxBuffer = 65536) {
  const result = spawnSync(path, args, { cwd, env: environment('C'), timeout: limits.timeoutMs, maxBuffer, killSignal: 'SIGKILL' });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  return result.stdout;
}

function validateReceipt(receipt) {
  assert.equal(receipt.inputsSha256, sha256(readFileSync(join(base, 'inputs.json'))));
  assert.equal(receipt.sourceBaselineCommit, baseline);
  assert.deepEqual(receipt.profiles.map(profile => profile.id), ['gnu-9.7-darwin-C', 'gnu-9.7-darwin-en_US.UTF-8', 'apple-darwin-C', 'apple-darwin-en_US.UTF-8']);
  for (const profile of receipt.profiles) {
    const selected = profile.locale === 'C' ? inputs.cases : inputs.cases.filter(entry => entry.group === 'encoding');
    assert.deepEqual(profile.results.map(row => row.id), selected.map(entry => entry.id));
    for (const [index, row] of profile.results.entries()) {
      assert.equal(row.caseSha256, caseSha256(selected[index]));
      assert.equal(row.failure, null, `${profile.id}/${row.id}: native infrastructure failure`);
      assert.equal(row.signal, null);
      assert(Number.isInteger(row.status));
      for (const key of ['stdoutBase64', 'stderrBase64']) assert.equal(Buffer.from(row[key], 'base64').toString('base64'), row[key]);
    }
  }
}

function verify() {
  const manifest = load(originalManifest);
  for (const entry of manifest.files) assert.equal(sha256(readFileSync(join(base, entry.path))), entry.sha256, `frozen hash mismatch: ${entry.path}`);
  const receipt = load(join(base, original, 'oracle.json'));
  validateReceipt(receipt);
  return { manifest, receipt };
}

function compareProfiles(expectedProfiles, actualProfiles) {
  assert.deepEqual(actualProfiles.map(profile => profile.id), expectedProfiles.map(profile => profile.id));
  return expectedProfiles.map((expected, profileIndex) => {
    const actual = actualProfiles[profileIndex];
    assert.deepEqual(actual.results.map(row => row.id), expected.results.map(row => row.id));
    const mismatches = [];
    let semanticMatches = 0;
    let diagnosticMatches = 0;
    let strictMatches = 0;
    for (const [index, reference] of expected.results.entries()) {
      const observed = actual.results[index];
      assert.equal(observed.caseSha256, reference.caseSha256);
      assert(Number.isInteger(observed.status));
      for (const key of ['stdoutBase64', 'stderrBase64']) assert.equal(Buffer.from(observed[key], 'base64').toString('base64'), observed[key]);
      const healthy = observed.failure == null && observed.signal == null;
      const semantic = healthy && observed.status === reference.status && observed.stdoutBase64 === reference.stdoutBase64 && Boolean(observed.stderrBase64) === Boolean(reference.stderrBase64);
      const diagnostic = healthy && observed.stderrBase64 === reference.stderrBase64;
      semanticMatches += Number(semantic);
      diagnosticMatches += Number(diagnostic);
      strictMatches += Number(semantic && diagnostic);
      if (!semantic || !diagnostic) mismatches.push({ id: reference.id, semantic, diagnostic, expected: reference, observed });
    }
    return { id: expected.id, denominator: expected.results.length, semanticMatches, diagnosticMatches, strictMatches, mismatches };
  });
}

async function observe() {
  const fixture = mkdtempSync(join(base, '.native-freeze-'));
  try {
    assert.equal(type(), 'Darwin', 'BLOCKED: pinned profile requires Darwin; no Linux relabeling');
    assert.equal(arch(), 'arm64', 'BLOCKED: native architecture changed');
    assert.equal(release(), '25.4.0', 'BLOCKED: native kernel changed');
    const identities = {};
    for (const [name, pin] of Object.entries(pins)) {
      const actualPath = realpathSync(resolve(root, pin.path));
      const hash = sha256(readFileSync(actualPath));
      assert.equal(hash, pin.sha256, `BLOCKED: ${name} native pin mismatch; no fallback`);
      identities[name] = { configuredPath: pin.path, actualPath, sha256: hash };
    }
    const archiveSource = boundedHelper('/usr/bin/tar', ['-xOf', identities.archive.actualPath, 'coreutils-9.7/src/expr.c'], fixture);
    assert.equal(sha256(archiveSource), identities.source.sha256, 'local source differs from authenticated archive');
    const locales = boundedHelper('/usr/bin/locale', ['-a'], fixture).toString().split('\n');
    for (const locale of ['C', 'en_US.UTF-8']) assert(locales.includes(locale), `BLOCKED: missing locale ${locale}`);
    for (const name of ['gnu', 'apple']) {
      identities[name].argv0 = 'expr';
      identities[name].versionProbe = await native(identities[name].actualPath, ['--version'], environment('C'), fixture);
      identities[name].versionSupported = name === 'gnu';
      identities[name].linkedLibraries = boundedHelper('/usr/bin/otool', ['-L', identities[name].actualPath], fixture).toString();
    }
    assert(Buffer.from(identities.gnu.versionProbe.stdoutBase64, 'base64').toString().startsWith('expr (GNU coreutils) 9.7\n'));
    const profiles = [];
    for (const name of ['gnu', 'apple']) {
      for (const locale of ['C', 'en_US.UTF-8']) {
        const env = environment(locale);
        const selected = locale === 'C' ? inputs.cases : inputs.cases.filter(entry => entry.group === 'encoding');
        const charmap = await native('/usr/bin/locale', ['charmap'], env, fixture, 'locale');
        assert.equal(charmap.status, 0);
        const results = [];
        for (const entry of selected) {
          const observation = await native(identities[name].actualPath, entry.argv, env, fixture);
          results.push({ id: entry.id, caseSha256: caseSha256(entry), argvUtf8Hex: entry.argv.map(token => Buffer.from(token).toString('hex')), ...observation });
        }
        profiles.push({ id: `${name === 'gnu' ? 'gnu-9.7' : 'apple'}-darwin-${locale}`, oracle: name, locale, environment: env, charmap, stdin: 'ignored descriptor /dev/null; no supplied input', actualExecutedPath: identities[name].actualPath, logicalArgv0: 'expr', results });
      }
    }
    assert.deepEqual(readdirSync(fixture), [], 'native expr unexpectedly changed isolated cwd');
    const sourcePaths = ['src/contracts/command.ts', 'src/contracts/command.md', 'src/contracts/io.ts', 'src/index.ts', 'src/shell/types.ts', 'package.json'];
    const receipt = {
      schema: 1,
      capturedAt: new Date().toISOString(),
      sourceBaselineCommit: baseline,
      baselineSrcTreeGitId: boundedHelper('git', ['rev-parse', `${baseline}:src`], root).toString().trim(),
      worktreeStatusAtCapture: boundedHelper('git', ['status', '--porcelain=v1', '--untracked-files=normal'], root).toString(),
      baselineInspectedApiSha256: sourcePaths.map(path => ({ path, sha256: sha256(boundedHelper('git', ['show', `${baseline}:${path}`], root)) })),
      inputsSha256: sha256(readFileSync(join(base, 'inputs.json'))),
      controlsSha256: sha256(readFileSync(join(base, 'controls.json'))),
      runnerSha256: sha256(readFileSync(join(base, 'runner.mjs.data'))),
      host: { type: type(), release: release(), arch: arch(), node: process.version, macOS: boundedHelper('/usr/bin/sw_vers', [], fixture).toString() },
      nativeLimits: limits,
      identities,
      fixture: { absolutePath: fixture, scope: 'empty unique owned cwd; removed after capture', effects: [], nativeShell: false, externalNetwork: false },
      profiles,
      acceptance: 'Native receipts only. No product candidate loaded, inspected, executed or accepted. No GNU/Linux or deployed-service claim.'
    };
    validateReceipt(receipt);
    return receipt;
  } finally {
    assert.equal(children.size, 0, 'must reap known children before fixture removal');
    assert(fixture.startsWith(join(base, '.native-freeze-')));
    rmSync(fixture, { recursive: true });
  }
}

function addFiles(files) {
  for (const [path] of files) assert(!existsSync(join(root, path)), `refuse overwrite: ${path}`);
  const patch = `*** Begin Patch\n${files.map(([path, text]) => `*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n`).join('')}*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', timeout: 15000, maxBuffer: 65536, killSignal: 'SIGKILL' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  process.stderr.write(result.stdout);
}

validateInputs();
const [mode = 'verify', argument] = process.argv.slice(2);
try {
  if (mode === 'verify') {
    const { receipt } = verify();
    console.log(json({ verified: true, inputCases: inputs.cases.length, observations: receipt.profiles.map(profile => ({ id: profile.id, count: profile.results.length })), appendProof: false, scope: 'Exact manifest-listed files only; unrelated/new files are neither included nor certified. No candidate execution.' }));
  } else if (mode === 'capture') {
    assert(argument && /^[a-z0-9][a-z0-9-]{0,79}$/.test(argument), 'capture requires a NEW explicit unique label');
    const directory = join(base, 'evidence', argument);
    assert(!existsSync(directory), 'capture destination already exists; immutable evidence cannot be rewritten');
    if (existsSync(originalManifest)) verify();
    const receipt = await observe();
    const oracleText = json(receipt);
    const oraclePath = relative(base, join(directory, 'oracle.json'));
    const listed = ['inputs.json', 'controls.json', 'primary-sources.json', 'runner.mjs.data', 'README.md'].map(path => ({ path, sha256: sha256(readFileSync(join(base, path))) }));
    listed.push({ path: oraclePath, sha256: sha256(oracleText) });
    const manifest = { schema: 1, sourceBaselineCommit: baseline, candidate: null, createdAt: receipt.capturedAt, hashAlgorithm: 'SHA256', files: listed, caseCount: inputs.cases.length, observations: receipt.profiles.reduce((sum, profile) => sum + profile.results.length, 0), immutablePolicy: 'Original files are never rewritten. Later captures require a new unique explicit directory. This manifest checks listed files, not appended entries.' };
    addFiles([[relative(root, join(directory, 'oracle.json')), oracleText], [relative(root, join(directory, 'manifest.json')), json(manifest)]]);
    console.log(json({ captured: relative(root, directory), count: manifest.observations }));
  } else if (mode === 'verify-native') {
    const { receipt } = verify();
    const actual = await observe();
    const results = compareProfiles(receipt.profiles, actual.profiles);
    verify();
    console.log(json({ nativeReplay: results, candidateAccepted: false }));
    if (results.some(profile => profile.strictMatches !== profile.denominator)) process.exitCode = 1;
  } else if (mode === 'compare') {
    const { receipt } = verify();
    assert(argument, 'compare requires an independently produced candidate report JSON path');
    const report = load(resolve(argument));
    assert.equal(report.freezeManifestSha256, sha256(readFileSync(originalManifest)));
    assert.equal(report.schema, 1);
    for (const field of ['commit', 'sourceTreeSha256', 'adapterSha256']) assert.equal(typeof report.candidate?.[field], 'string', `missing candidate provenance ${field}`);
    assert.equal(typeof report.candidate.dirty, 'boolean');
    const expected = receipt.profiles.filter(profile => profile.oracle === 'gnu');
    const results = compareProfiles(expected, report.profiles);
    verify();
    console.log(json({ comparison: results, candidate: report.candidate, safetyControls: 'NOT EXECUTED by this comparator', productAcceptance: false }));
    if (results.some(profile => profile.strictMatches !== profile.denominator)) process.exitCode = 1;
  } else throw new Error(`Unknown mode ${mode}; use verify, capture NEW-LABEL, verify-native, compare REPORT.json`);
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
