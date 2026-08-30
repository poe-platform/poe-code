import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, lstatSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { arch, release, tmpdir, type } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
export const owned = 'tests/commands/expr-stress/diagnostics-review/replay';
export const originalCommit = '35aa8054ac0ebc1eacefc7cde63e4706f4c72137';
export const extensionCommit = '92fe8a63';
export const originalBase = 'tests/commands/expr-stress/frozen';
export const extensionBase = 'tests/commands/expr-stress/extension-review/frozen';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export function git(...args) {
  const result = spawnSync('git', args, { cwd: root, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
export const frozen = (commit, path) => git('show', `${commit}:${path}`);
export const frozenJson = (commit, path) => JSON.parse(frozen(commit, path));
export function addEvidence(path, value) {
  assert(path.startsWith(`${owned}/`));
  assert(!existsSync(join(root, path)), `refuse overwrite ${path}`);
  const text = typeof value === 'string' ? value : json(value);
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { cwd: root, input: patch, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}
function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `unexpected symlink ${path}`);
    return stat.isDirectory() ? inventory(path, rel) : [rel];
  });
}
export function verifyFrozen() {
  const receipts = [];
  for (const [commit, base] of [[originalCommit, originalBase], [extensionCommit, extensionBase]]) {
    const names = git('ls-tree', '-r', '--name-only', commit, '--', base).toString().trim().split('\n');
    const actual = inventory(join(root, base)).map(path => `${base}/${path}`);
    assert.deepEqual(actual.sort(), [...names].sort(), `frozen inventory changed ${base}`);
    const files = names.map(path => {
      const bytes = frozen(commit, path);
      assert.deepEqual(readFileSync(join(root, path)), bytes, `frozen bytes changed ${path}`);
      return { path, sha256: sha256(bytes) };
    });
    receipts.push({ commit: git('rev-parse', `${commit}^{commit}`).toString().trim(), base, files, appendedEntriesChecked: true });
  }
  return receipts;
}
export function cohorts() {
  return [
    { id: 'original95', commit: originalCommit, base: originalBase, receipt: frozenJson(originalCommit, `${originalBase}/evidence/original-20260827/oracle.json`) },
    { id: 'extension-original20', commit: extensionCommit, base: extensionBase, receipt: frozenJson(extensionCommit, `${extensionBase}/evidence/native-20260827/oracle.json`) },
    { id: 'extension-correction1', commit: extensionCommit, base: extensionBase, receipt: frozenJson(extensionCommit, `${extensionBase}/evidence/quoted-parenthesis-20260827/oracle.json`) },
  ];
}
export function compare(expected, actual) {
  const semantic = expected.status === actual.status && expected.stdoutBase64 === actual.stdoutBase64 && Boolean(expected.stderrBase64) === Boolean(actual.stderrBase64) && !actual.failure && !actual.signal;
  const diagnostic = expected.stderrBase64 === actual.stderrBase64;
  return { semantic: Boolean(semantic), diagnostic, strict: Boolean(semantic && diagnostic) };
}
const children = new Set();
let interrupted = false;
function interrupt() {
  interrupted = true;
  for (const child of children) child.kill('SIGKILL');
}
export async function boundedNative(binary, args, cwd, env, argv0 = 'expr') {
  assert(!interrupted, 'admission closed by interruption');
  assert(args.length <= 128);
  assert(args.reduce((sum, arg) => sum + Buffer.byteLength(arg) + 1, 0) <= 8192);
  return await new Promise(resolveResult => {
    const child = spawn(binary, args, { cwd, env, argv0, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const stdout = [], stderr = [];
    let size = 0, failure = null;
    const timer = setTimeout(() => { failure = 'native deadline 2000ms'; child.kill('SIGKILL'); }, 2000);
    for (const [stream, target] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', bytes => {
      size += bytes.length;
      if (size > 65536) { failure = 'native output cap 65536'; child.kill('SIGKILL'); }
      else target.push(Buffer.from(bytes));
    });
    child.on('error', error => { failure = error.message; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      children.delete(child);
      resolveResult({ status, signal, failure, stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64') });
    });
  });
}
export async function nativeReplay() {
  const fixture = mkdtempSync(join(tmpdir(), 'expr-final-native-'));
  const startedAt = new Date().toISOString();
  const original = cohorts()[0].receipt;
  const output = { schema: 1, startedAt, host: { type: type(), release: release(), arch: arch(), node: process.version }, identities: [], cohorts: [], candidate: null, limits: original.nativeLimits };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    for (const field of ['type', 'release', 'arch']) assert.equal(output.host[field], original.host[field], `native host ${field} mismatch`);
    for (const [name, identity] of Object.entries(original.identities)) {
      const path = resolve(root, identity.configuredPath);
      assert.equal(realpathSync(path), identity.actualPath, `native path mismatch ${name}`);
      assert.equal(sha256(readFileSync(path)), identity.sha256, `native hash mismatch ${name}`);
      const entry = { name, path, sha256: identity.sha256 };
      if (identity.versionProbe) {
        entry.version = await boundedNative(path, ['--version'], fixture, original.profiles[0].environment);
        assert(compare(identity.versionProbe, entry.version).strict, `${name} version changed`);
        entry.linkedLibraries = await boundedNative('/usr/bin/otool', ['-L', path], fixture, original.profiles[0].environment, 'otool');
        assert.equal(Buffer.from(entry.linkedLibraries.stdoutBase64, 'base64').toString(), identity.linkedLibraries);
      }
      output.identities.push(entry);
    }
    const sourceMember = spawnSync('/usr/bin/tar', ['-xOf', original.identities.archive.actualPath, 'coreutils-9.7/src/expr.c'], { timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    assert.ifError(sourceMember.error);
    assert.equal(sourceMember.status, 0);
    assert.equal(sha256(sourceMember.stdout), original.identities.source.sha256);
    output.sourceMemberSha256 = sha256(sourceMember.stdout);
    output.macOS = await boundedNative('/usr/bin/sw_vers', [], fixture, original.profiles[0].environment, 'sw_vers');
    assert.equal(Buffer.from(output.macOS.stdoutBase64, 'base64').toString(), original.host.macOS);
    for (const cohort of cohorts()) {
      const observed = { id: cohort.id, profiles: [] };
      for (const profile of cohort.receipt.profiles) {
        const results = profile.results ?? [{ ...profile.result, argvUtf8Hex: cohort.receipt.argvUtf8Hex }];
        const actual = { id: profile.id, environment: profile.environment, results: [] };
        actual.charmap = await boundedNative('/usr/bin/locale', ['charmap'], fixture, profile.environment, 'locale');
        const originalProfile = original.profiles.find(item => item.id === profile.id);
        assert(compare(originalProfile.charmap, actual.charmap).strict, `locale unavailable ${profile.id}`);
        for (const expected of results) {
          const args = expected.argvUtf8Hex.map(hex => Buffer.from(hex, 'hex').toString('utf8'));
          const result = await boundedNative(profile.actualExecutedPath, args, fixture, profile.environment);
          actual.results.push({ id: expected.id, caseSha256: expected.caseSha256 ?? null, ...result, comparison: compare(expected, result) });
        }
        actual.denominator = results.length;
        actual.strictMatches = actual.results.filter(item => item.comparison.strict).length;
        observed.profiles.push(actual);
      }
      output.cohorts.push(observed);
    }
    assert.deepEqual(readdirSync(fixture), [], 'native fixture changed');
    output.qualification = output.cohorts.every(cohort => cohort.profiles.every(profile => profile.strictMatches === profile.denominator)) ? 'PASS NATIVE REPLAY ONLY' : 'FAIL NATIVE REPLAY';
  } catch (error) {
    output.qualification = 'FAILED NATIVE QUALIFICATION';
    output.failure = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    assert.equal(children.size, 0);
    rmSync(fixture, { recursive: true });
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    output.cleanup = { childrenRemaining: children.size, scratchRemoved: !existsSync(fixture), fixture };
    output.completedAt = new Date().toISOString();
  }
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode = 'verify', label] = process.argv.slice(2);
  const before = verifyFrozen();
  if (mode === 'verify') console.log(json({ verified: true, freezes: before, productExecuted: false }));
  else if (mode === 'capture-native') {
    assert(label && /^[a-z0-9][a-z0-9-]{0,79}$/.test(label), 'NEW explicit capture label required');
    const destination = `${owned}/${label}/native-replay.json`;
    assert(!existsSync(join(root, owned, label)), 'capture directory already exists');
    const report = await nativeReplay();
    assert.deepEqual(verifyFrozen(), before);
    addEvidence(destination, { ...report, freezes: before, adapterSha256: sha256(readFileSync(fileURLToPath(import.meta.url))) });
    console.log(json({ destination, qualification: report.qualification, cohorts: report.cohorts.map(cohort => ({ id: cohort.id, profiles: cohort.profiles.map(({ id, denominator, strictMatches }) => ({ id, denominator, strictMatches })) })), cleanup: report.cleanup }));
    if (report.qualification !== 'PASS NATIVE REPLAY ONLY') process.exitCode = 1;
  } else throw new Error('Use verify or capture-native NEW-LABEL');
}
