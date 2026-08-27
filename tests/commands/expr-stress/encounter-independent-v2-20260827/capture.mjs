import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, symlinkSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const frozenCommit = '30dda5b9';
const manifest = JSON.parse(readFileSync(join(owned, 'freeze/manifest.json')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const name = process.argv[3];
assert(process.argv[2] === '--capture' && /^[a-z0-9-]+$/u.test(name ?? ''), 'Usage: capture.mjs --capture UNIQUE-NAME');
const output = join(owned, name);
assert(!existsSync(output), 'refuse capture overwrite');
mkdirSync(output);
const save = (filename, value) => writeFileSync(join(output, filename), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
function command(executable, args, cwd = root, timeout = 120000) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd, timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, TSX_DISABLE_CACHE: '1' } });
  return { executable, args, cwd, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
}
function git(...args) {
  const result = command('git', args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function inventory(directory, excludes = []) {
  const records = {};
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current).sort()) {
      if (!prefix && excludes.includes(entry)) continue;
      const filename = prefix ? `${prefix}/${entry}` : entry;
      const absolute = join(current, entry);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) records[filename] = { kind: 'symlink', target: readlinkSync(absolute) };
      else if (stat.isDirectory()) { records[filename] = { kind: 'directory' }; walk(absolute, filename); }
      else records[filename] = { kind: 'file', bytes: stat.size, sha256: sha256(readFileSync(absolute)) };
    }
  }
  walk(directory);
  return records;
}
function verifyFrozen() {
  const paths = git('ls-tree', '-r', '--name-only', frozenCommit, '--', relative(root, owned)).trim().split('\n');
  const records = {};
  for (const filename of paths) {
    const expected = sha256(Buffer.from(git('show', `${frozenCommit}:${filename}`)));
    const actual = sha256(readFileSync(join(root, filename)));
    assert.equal(actual, expected, filename);
    records[relative(owned, join(root, filename))] = actual;
  }
  for (const folder of ['freeze', 'historical']) {
    const actual = Object.entries(inventory(join(owned, folder))).filter(([, entry]) => entry.kind !== 'directory').map(([filename]) => `${folder}/${filename}`).sort();
    assert.deepEqual(actual, Object.keys(records).filter(filename => filename.startsWith(`${folder}/`)).sort(), 'frozen data append detection');
  }
  return records;
}
const temporaryParent = join(owned, 'node_modules');
const scratch = join(temporaryParent, name);
assert(!existsSync(scratch), 'refuse scratch overwrite');
const createdParent = !existsSync(temporaryParent);
let before, compiledBefore;
try {
  save('freeze-before.json', verifyFrozen());
  const compressed = Buffer.from(readFileSync(join(owned, 'freeze/source-archive.b64.data'), 'utf8').trim(), 'base64');
  assert.equal(sha256(compressed), manifest.archiveSha256);
  const bytes = gunzipSync(compressed);
  assert.equal(sha256(bytes), manifest.expandedSha256);
  const source = JSON.parse(bytes);
  mkdirSync(scratch, { recursive: true });
  for (const [filename, text] of Object.entries(source)) {
    assert(filename.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(filename));
    const destination = resolve(scratch, filename);
    assert(destination.startsWith(`${scratch}/`));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text, { flag: 'wx' });
  }
  before = inventory(scratch);
  save('source-before.json', before);
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  const build = command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--skipLibCheck', 'false'], scratch);
  save('build.json', build);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  compiledBefore = inventory(join(scratch, 'dist'));
  save('compiled-before.json', compiledBefore);
  const original = command(process.execPath, [join(owned, 'freeze/original-driver.mjs'), scratch, join(owned, 'freeze/original-cases.json')]);
  save('original-execution.json', original);
  assert.equal(original.status, 0, original.stderr);
  const originalResults = JSON.parse(original.stdout);
  save('original-results.json', originalResults);
  const nearby = command(process.execPath, [join(owned, 'nearby-driver.mjs'), scratch, join(owned, 'freeze/controls.json')]);
  save('nearby-execution.json', nearby);
  assert.equal(nearby.status, 0, nearby.stderr);
  const nearbyResults = JSON.parse(nearby.stdout);
  save('nearby-results.json', nearbyResults);
  const cohort = cases => ({ passed: cases.filter(specimen => specimen.passed).length, total: cases.length, failures: cases.filter(specimen => !specimen.passed).map(specimen => ({ id: specimen.id, failures: specimen.failures })) });
  const frozen = JSON.parse(readFileSync(join(owned, 'freeze/original-cases.json')));
  const qualified = JSON.parse(JSON.parse(readFileSync(join(owned, 'historical/qualified-sequencing.json'))).stdout);
  const baselineFailures = originalResults.cases.filter(specimen => !specimen.passed).map(specimen => specimen.id);
  const qualifiedFailures = qualified.cases.filter(specimen => !specimen.passed).map(specimen => specimen.id);
  save('summary.json', {
    freezeCommit: git('rev-parse', frozenCommit).trim(), baselineCommit: manifest.baselineCommit,
    platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
    native: 'Not executed; only authenticated existing GNU coreutils 9.7 Darwin frozen expectations. Nearby cases are project-policy controls, not native claims.',
    original: cohort(originalResults.cases), nativeSubset: cohort(originalResults.cases.filter((specimen, index) => frozen.cases[index].native !== false)), projectSubset: cohort(originalResults.cases.filter((specimen, index) => frozen.cases[index].native === false)),
    shell: cohort(originalResults.shell), oldCapSeparate: originalResults.oldCap,
    nearby: cohort(nearbyResults.cases), same19FailureIdsAsQualified: JSON.stringify(baselineFailures) === JSON.stringify(qualifiedFailures),
    activeWorkers: { original: originalResults.activeWorkers, nearby: nearbyResults.activeWorkers },
    qualification: 'Baseline source archive only; no parser candidate, no later quota-only source, no full gate or public consumer acceptance.',
  });
} finally {
  if (existsSync(scratch)) {
    if (before) {
      const after = inventory(scratch, ['node_modules', 'dist']);
      save('source-after.json', after);
      assert.deepEqual(after, before, 'complete source inventory including new entries');
    }
    if (compiledBefore) {
      const compiledAfter = inventory(join(scratch, 'dist'));
      save('compiled-after.json', compiledAfter);
      assert.deepEqual(compiledAfter, compiledBefore, 'complete compiled inventory including new entries');
    }
    rmSync(scratch, { recursive: true });
  }
  if (createdParent && existsSync(temporaryParent)) rmdirSync(temporaryParent);
  save('freeze-after.json', verifyFrozen());
  save('cleanup.json', { scratch, scratchAbsent: !existsSync(scratch), createdParent, temporaryParentAbsent: !existsSync(temporaryParent), children: 'spawnSync children settled; worker drivers report and await owned workers', integrity: 'Frozen original paths rehashed plus append detection in freeze/historical; full extracted source and compiled inventories compare new entries too.' });
}
console.log(readFileSync(join(output, 'summary.json'), 'utf8'));
