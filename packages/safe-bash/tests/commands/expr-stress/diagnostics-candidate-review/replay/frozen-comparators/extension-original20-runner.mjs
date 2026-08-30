import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { arch, release, type } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const base = resolve(root, 'tests/commands/expr-stress/extension-review/frozen');
const originalBase = 'tests/commands/expr-stress/frozen';
const originalCommit = '35aa8054ac0ebc1eacefc7cde63e4706f4c72137';
const baseline = '8f19a9d5bb244ff6c095b7117e6d0738fdf40421';
const manifestPath = join(base, 'evidence/native-20260827/manifest.json');
const limits = { timeoutMs: 2000, combinedOutputBytes: 65536, argumentBytes: 8192, argumentCount: 128 };
const pins = {
  gnu: { path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr', sha256: 'e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c' },
  apple: { path: '/bin/expr', sha256: '584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f' },
  archive: { path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz', sha256: 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf' },
  source: { path: 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr.c', sha256: 'c9dc5e04039505ab48a350e9407b1d83b2574fd7e2c31c9d23f4bf942d1b8af0' }
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const load = file => JSON.parse(readFileSync(file, 'utf8'));
const environment = locale => ({ PATH: '/usr/bin:/bin', LC_ALL: locale, LANG: locale, LANGUAGE: 'C', TZ: 'UTC' });
const inputs = load(join(base, 'inputs.json'));
const controls = load(join(base, 'controls.json'));
const mutations = load(join(base, 'mutations.json'));
const children = new Set();
let interrupted = false;
const interrupt = () => { interrupted = true; for (const child of children) child.kill('SIGKILL'); };

function helper(binary, args, cwd = root, maxBuffer = 2 * 1024 * 1024) {
  const result = spawnSync(binary, args, { cwd, env: environment('C'), timeout: limits.timeoutMs, maxBuffer, killSignal: 'SIGKILL' });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `${binary}: ${result.stderr}`);
  return result.stdout;
}

function validateInputs() {
  assert.equal(inputs.cases.length, 20);
  assert.equal(inputs.cases.filter(entry => entry.group === 'encoding').length, 3);
  assert.equal(controls.controls.length, 24);
  assert.equal(mutations.mutations.length, 32);
  for (const entries of [inputs.cases, controls.controls, mutations.mutations]) assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  const original = JSON.parse(helper('git', ['show', `${originalCommit}:${originalBase}/inputs.json`]));
  assert.equal(original.cases.length, 95);
  const existing = new Set(original.cases.map(entry => JSON.stringify(entry.argv)));
  for (const entry of inputs.cases) {
    assert(!existing.has(JSON.stringify(entry.argv)), `duplicate original argv: ${entry.id}`);
    assert(entry.argv.length <= limits.argumentCount);
    assert(entry.argv.every(token => typeof token === 'string' && token.isWellFormed() && !token.includes('\0')));
    assert(entry.argv.reduce((total, token) => total + Buffer.byteLength(token) + 1, 0) <= limits.argumentBytes);
  }
  const provenance = load(join(base, 'provenance.json'));
  assert.equal(provenance.sourceBaseline, baseline);
  assert.equal(provenance.originalCommit, originalCommit);
  for (const entry of provenance.originalFiles) {
    assert.equal(sha256(helper('git', ['show', `${originalCommit}:${entry.path}`])), entry.sha256);
    assert.equal(sha256(readFileSync(join(root, entry.path))), entry.sha256, `original freeze changed: ${entry.path}`);
  }
  for (const entry of provenance.baselineFiles) assert.equal(sha256(helper('git', ['show', `${baseline}:${entry.path}`])), entry.sha256);
}

async function native(binary, args, env, cwd, argv0 = 'expr') {
  assert(!interrupted, 'interrupted: admission closed');
  return await new Promise((resolveResult, rejectResult) => {
    const child = spawn(binary, args, { cwd, env, argv0, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let size = 0;
    let failure = null;
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => { failure = 'timeout'; child.kill('SIGKILL'); }, limits.timeoutMs);
    const collect = target => chunk => {
      size += chunk.length;
      if (size > limits.combinedOutputBytes) { failure = 'output-limit'; child.kill('SIGKILL'); }
      else target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', error => { failure = `spawn-error: ${error.message}`; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      children.delete(child);
      if (interrupted) rejectResult(new Error('interrupted; native child reaped'));
      else resolveResult({ status, signal, failure, stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64') });
    });
  });
}

function validateReceipt(receipt) {
  assert.equal(receipt.inputsSha256, sha256(readFileSync(join(base, 'inputs.json'))));
  assert.equal(receipt.sourceBaseline, baseline);
  assert.deepEqual(receipt.profiles.map(profile => profile.id), ['gnu-9.7-darwin-C', 'gnu-9.7-darwin-en_US.UTF-8', 'apple-darwin-C', 'apple-darwin-en_US.UTF-8']);
  for (const profile of receipt.profiles) {
    const selected = profile.locale === 'C' ? inputs.cases : inputs.cases.filter(entry => entry.group === 'encoding');
    assert.deepEqual(profile.results.map(row => row.id), selected.map(entry => entry.id));
    for (const [index, row] of profile.results.entries()) {
      assert.equal(row.caseSha256, sha256(JSON.stringify(selected[index])));
      assert.deepEqual(row.argvUtf8Hex, selected[index].argv.map(token => Buffer.from(token).toString('hex')));
      assert.equal(row.failure, null);
      assert.equal(row.signal, null);
      assert(Number.isInteger(row.status));
      for (const key of ['stdoutBase64', 'stderrBase64']) assert.equal(Buffer.from(row[key], 'base64').toString('base64'), row[key]);
    }
  }
}

function verify() {
  validateInputs();
  const manifest = load(manifestPath);
  for (const entry of manifest.files) assert.equal(sha256(readFileSync(join(base, entry.path))), entry.sha256, `freeze mismatch: ${entry.path}`);
  const receipt = load(join(base, manifest.oraclePath));
  validateReceipt(receipt);
  return { manifest, receipt };
}

async function observe() {
  validateInputs();
  assert.equal(type(), 'Darwin', 'BLOCKED: no profile substitution');
  assert.equal(arch(), 'arm64');
  assert.equal(release(), '25.4.0');
  const fixture = mkdtempSync(join(base, '.native-extension-'));
  try {
    const identities = {};
    for (const [name, pin] of Object.entries(pins)) {
      const actualPath = realpathSync(resolve(root, pin.path));
      const hash = sha256(readFileSync(actualPath));
      assert.equal(hash, pin.sha256, `BLOCKED: pin mismatch ${name}`);
      identities[name] = { configuredPath: pin.path, actualPath, sha256: hash };
    }
    assert.equal(sha256(helper('/usr/bin/tar', ['-xOf', identities.archive.actualPath, 'coreutils-9.7/src/expr.c'], fixture)), pins.source.sha256);
    const releaseManualSha256 = sha256(helper('/usr/bin/tar', ['-xOf', identities.archive.actualPath, 'coreutils-9.7/doc/coreutils.texi'], fixture));
    const locales = helper('/usr/bin/locale', ['-a'], fixture).toString().split('\n');
    for (const locale of ['C', 'en_US.UTF-8']) assert(locales.includes(locale), `BLOCKED: missing locale ${locale}`);
    for (const name of ['gnu', 'apple']) {
      identities[name].versionProbe = await native(identities[name].actualPath, ['--version'], environment('C'), fixture);
      identities[name].versionSupported = name === 'gnu';
      identities[name].linkedLibraries = helper('/usr/bin/otool', ['-L', identities[name].actualPath], fixture).toString();
    }
    assert.equal(identities.gnu.versionProbe.status, 0);
    assert(Buffer.from(identities.gnu.versionProbe.stdoutBase64, 'base64').toString().startsWith('expr (GNU coreutils) 9.7\n'));
    const profiles = [];
    for (const name of ['gnu', 'apple']) {
      for (const locale of ['C', 'en_US.UTF-8']) {
        const selected = locale === 'C' ? inputs.cases : inputs.cases.filter(entry => entry.group === 'encoding');
        const env = environment(locale);
        const charmap = await native('/usr/bin/locale', ['charmap'], env, fixture, 'locale');
        assert.equal(charmap.status, 0);
        const results = [];
        for (const entry of selected) results.push({ id: entry.id, caseSha256: sha256(JSON.stringify(entry)), argvUtf8Hex: entry.argv.map(token => Buffer.from(token).toString('hex')), ...await native(identities[name].actualPath, entry.argv, env, fixture) });
        profiles.push({ id: `${name === 'gnu' ? 'gnu-9.7' : 'apple'}-darwin-${locale}`, oracle: name, locale, environment: env, charmap, actualExecutedPath: identities[name].actualPath, logicalArgv0: 'expr', results });
      }
    }
    assert.deepEqual(readdirSync(fixture), [], 'native cwd effects');
    const receipt = { schema: 1, capturedAt: new Date().toISOString(), sourceBaseline: baseline, candidate: null, inputsSha256: sha256(readFileSync(join(base, 'inputs.json'))), provenanceSha256: sha256(readFileSync(join(base, 'provenance.json'))), runnerSha256: sha256(readFileSync(join(base, 'runner.mjs.data'))), host: { type: type(), release: release(), arch: arch(), node: process.version, macOS: helper('/usr/bin/sw_vers', [], fixture).toString() }, identities, releaseManualSha256, limits, fixture: { absolutePath: fixture, removedAfterCapture: true, effects: [], stdin: 'ignored', shell: false, network: false }, profiles, productControlsExecuted: 0, candidateAccepted: false };
    validateReceipt(receipt);
    return receipt;
  } finally {
    assert.equal(children.size, 0);
    assert(fixture.startsWith(join(base, '.native-extension-')));
    rmSync(fixture, { recursive: true });
  }
}

function addFiles(files) {
  for (const [file] of files) assert(!existsSync(join(root, file)), `refuse overwrite: ${file}`);
  const patch = `*** Begin Patch\n${files.map(([file, text]) => `*** Add File: ${file}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n`).join('')}*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', timeout: 15000, maxBuffer: 65536, killSignal: 'SIGKILL' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  process.stderr.write(result.stdout);
}

function compareProfiles(expected, actual) {
  assert.deepEqual(actual.map(profile => profile.id), expected.map(profile => profile.id));
  return expected.map((profile, profileIndex) => {
    const observed = actual[profileIndex];
    assert.deepEqual(observed.results.map(row => row.id), profile.results.map(row => row.id));
    const mismatches = [];
    let semanticMatches = 0;
    let diagnosticMatches = 0;
    let strictMatches = 0;
    for (const [index, reference] of profile.results.entries()) {
      const row = observed.results[index];
      assert.equal(row.caseSha256, reference.caseSha256);
      assert.equal(row.failure, null);
      assert.equal(row.signal, null);
      assert(Number.isInteger(row.status));
      for (const key of ['stdoutBase64', 'stderrBase64']) { assert.equal(typeof row[key], 'string'); assert.equal(Buffer.from(row[key], 'base64').toString('base64'), row[key]); }
      const semantic = row.status === reference.status && row.stdoutBase64 === reference.stdoutBase64 && Boolean(row.stderrBase64) === Boolean(reference.stderrBase64);
      const diagnostic = row.stderrBase64 === reference.stderrBase64;
      semanticMatches += Number(semantic);
      diagnosticMatches += Number(diagnostic);
      strictMatches += Number(semantic && diagnostic);
      if (!semantic || !diagnostic) mismatches.push({ reference, observed: row, semantic, diagnostic });
    }
    return { id: profile.id, denominator: profile.results.length, semanticMatches, diagnosticMatches, strictMatches, mismatches };
  });
}

process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const [mode = 'verify', argument] = process.argv.slice(2);
try {
  if (mode === 'capture') {
    assert(argument && /^[a-z0-9][a-z0-9-]{0,79}$/.test(argument), 'NEW unique label required');
    const directory = join(base, 'evidence', argument);
    assert(!existsSync(directory), 'immutable capture already exists');
    if (existsSync(manifestPath)) verify();
    const receipt = await observe();
    const oraclePath = relative(base, join(directory, 'oracle.json'));
    const oracleText = json(receipt);
    const files = ['README.md', 'inputs.json', 'controls.json', 'mutations.json', 'primary-sources.json', 'provenance.json', 'runner.mjs.data'].map(file => ({ path: file, sha256: sha256(readFileSync(join(base, file))) }));
    files.push({ path: oraclePath, sha256: sha256(oracleText) });
    const manifest = { schema: 1, createdAt: receipt.capturedAt, sourceBaseline: baseline, originalCommit, candidate: null, oraclePath, files, counts: { cases: 20, gnuObservations: 23, appleObservations: 23, controls: 24, mutationSpecifications: 32, candidateControlsExecuted: 0 }, appendProof: false };
    addFiles([[relative(root, join(directory, 'oracle.json')), oracleText], [relative(root, join(directory, 'manifest.json')), json(manifest)]]);
    console.log(json({ captured: relative(root, directory), counts: manifest.counts, candidateAccepted: false }));
  } else if (mode === 'verify') {
    const { manifest } = verify();
    console.log(json({ verified: true, manifestSha256: sha256(readFileSync(manifestPath)), counts: manifest.counts, appendProof: false, candidateAccepted: false }));
  } else if (mode === 'verify-native' || mode === 'compare') {
    const { receipt } = verify();
    let expected = receipt.profiles;
    let observed;
    if (mode === 'verify-native') observed = (await observe()).profiles;
    else {
      assert(argument, 'compare needs independently generated report');
      const report = load(resolve(argument));
      assert.equal(report.schema, 1);
      assert.equal(report.freezeManifestSha256, sha256(readFileSync(manifestPath)));
      for (const field of ['commit', 'sourceTreeSha256', 'adapterSha256', 'installedArtifactSha256']) assert.equal(typeof report.candidate?.[field], 'string');
      assert.equal(typeof report.candidate.dirty, 'boolean');
      expected = receipt.profiles.filter(profile => profile.oracle === 'gnu');
      observed = report.profiles;
    }
    const comparison = compareProfiles(expected, observed);
    verify();
    console.log(json({ mode, comparison, controlsExecutedByComparator: 0, provenanceSelfReportNotAuthenticated: mode === 'compare', candidateAccepted: false }));
    if (comparison.some(profile => profile.strictMatches !== profile.denominator)) process.exitCode = 1;
  } else throw new Error('Use verify (default), capture NEW-LABEL, verify-native or compare REPORT.json');
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
