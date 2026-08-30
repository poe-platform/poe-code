import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {verifyDriverSeal} from '../admission.mjs';
import {readProfile} from '../profile.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const shipping = dirname(directory);
const repository = fileURLToPath(new URL('../../../../../../', import.meta.url));
const source = 'fe15f1e406fa1039accddec25c696ae7187f6135';
const harness = '07db17c0c37e2a5e9dbe77c248c48a67c7a6fa76';
const gitBinary = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync(gitBinary, ['--no-replace-objects', ...args], {cwd: repository, maxBuffer: 8 * 1024 * 1024});
const json = path => JSON.parse(readFileSync(path));
const cohorts = [
  ['route-01', 'unified76-route-controls-YGVIeQ', '484c5c2aabc26e74784e14e9f47dabfc39aacca4', [5, 7]],
  ['route-02', 'unified76-route-controls-hhjfAG', '6fd073379fe530e0c3cec024a856f55810857ead', [11, 1]],
  ['route-03', 'unified76-route-controls-7Qlqwt', '6fd073379fe530e0c3cec024a856f55810857ead', [12, 0]],
  ['route-04', 'unified76-route-controls-leu2jM', '8b095f998f50cd849b7daa692b7929d551a4b697', [12, 0]],
  ['route-05', 'unified76-route-controls-JRJ3sT', source, [12, 0]],
  ['protocol-01', 'unified76-os-protocol-xmjHrA', '6fd073379fe530e0c3cec024a856f55810857ead', null],
  ['protocol-02', 'unified76-os-protocol-sAgm7O', '8b095f998f50cd849b7daa692b7929d551a4b697', null],
];

function inventory(root) {
  const entries = [];
  function visit(path) {
    assert.notEqual(path.split('/').at(-1).toLowerCase(), 'agents.md');
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `no evidence symlink: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else {
      assert.ok(stat.isFile() && stat.size <= 8 * 1024 * 1024);
      entries.push({path: relative(root, path), bytes: stat.size, mode: stat.mode & 0o777, sha256: sha(readFileSync(path))});
    }
  }
  visit(root);
  return entries;
}

function run() {
  assert.deepEqual(process.argv.slice(2), ['--seal-existing-evidence']);
  const output = join(directory, 'evidence-v2');
  assert.ok(!existsSync(output), 'append-only evidence destination already exists');
  const seal = verifyDriverSeal();
  const prefix = relative(repository, shipping);
  const expectedSeal = JSON.parse(git('show', `${source}:${prefix}/DRIVER.json`));
  assert.deepEqual(seal, expectedSeal);
  assert.equal(sha(JSON.stringify(seal)), '25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527');
  const earlier = JSON.parse(git('show', `86038b27:${prefix}/DRIVER.json`));
  assert.equal(Object.keys(earlier.files).length, 35);
  assert.deepEqual(Object.keys(seal.files).filter(path => !Object.hasOwn(earlier.files, path)).sort(), ['TOOL-ROUTES.json', 'tool-routing.mjs']);
  assert.ok(Object.keys(earlier.files).every(path => Object.hasOwn(seal.files, path)));
  const files = Object.entries(seal.files).map(([path, digest]) => {
    const fullPath = `${prefix}/${path}`;
    const bytes = git('show', `${source}:${fullPath}`);
    assert.equal(sha(bytes), digest);
    assert.deepEqual(readFileSync(join(shipping, path)), bytes);
    const [mode, kind, blob] = git('ls-tree', source, '--', fullPath).toString().split(/\s+/u);
    assert.equal(kind, 'blob');
    return {path, mode, blob, bytes: bytes.length, sha256: digest};
  });
  const controls = readFileSync(join(directory, 'CONTROLS.json'));
  assert.deepEqual(controls, git('show', `0444f359:${prefix}/tool-routes-v1/CONTROLS.json`));
  const projection = json(join(shipping, 'INSTRUCTION-PROJECTION.json'));
  const forbiddenContent = new Set([...projection.candidateEntries, ...projection.dependencyEntries].map(entry => entry.sha256));
  const profile = readProfile();
  assert.equal(sha(JSON.stringify(profile)), '8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f');
  assert.equal(sha(JSON.stringify(projection)), 'b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb');
  const prepared = cohorts.map(([name, folder, revision, counts]) => {
    const root = `/private/tmp/${folder}`;
    assert.equal(realpathSync(root), root);
    const report = json(join(root, 'REPORT.json'));
    if (counts) {
      assert.deepEqual([report.pass, report.fail], counts);
      assert.equal(report.fullGatePhases, 0);
      assert.equal(report.builds, 0);
      assert.deepEqual(report.source, JSON.parse(git('show', `${revision}:${prefix}/DRIVER.json`)));
      for (const record of report.cleanup) assert.ok(record.absent && !existsSync(record.path));
      const helperPath = join(root, 'HELPER-INPUTS.json');
      if (existsSync(helperPath)) for (const entry of json(helperPath).entries) assert.ok(!forbiddenContent.has(entry.sha256));
    } else {
      assert.equal(report.rows.length, 9);
      assert.equal(report.foreignReaped, true);
      for (const row of report.rows) if (row.receipt.observerReceipt) assert.deepEqual(row.receipt.observerReceipt.survivors, []);
    }
    return {name, root, revision, counts, report, files: inventory(root)};
  });
  const total = prepared.flatMap(item => item.files).reduce((sum, item) => sum + item.bytes, 0);
  assert.ok(total <= 32 * 1024 * 1024, 'finite evidence capture bound');
  mkdirSync(output);
  const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  const captures = [];
  for (const cohort of prepared) {
    const rows = [];
    for (const entry of cohort.files) {
      const bytes = readFileSync(join(cohort.root, entry.path));
      assert.equal(sha(bytes), entry.sha256);
      assert.ok(!forbiddenContent.has(entry.sha256));
      const destination = `${cohort.name}/${entry.path}.gz`;
      const compressed = gzipSync(bytes);
      mkdirSync(dirname(join(output, destination)), {recursive: true});
      writeFileSync(join(output, destination), compressed, {flag: 'wx'});
      rows.push({...entry, captured: destination, compressedBytes: compressed.length, compressedSha256: sha(compressed)});
    }
    assert.deepEqual(inventory(cohort.root), cohort.files);
    captures.push({name: cohort.name, originalRoot: cohort.root, source: cohort.revision, counts: cohort.counts, files: rows});
  }
  save('RAW-INDEX.json', {at: new Date().toISOString(), totalRawBytes: total, captures});
  save('SOURCE-BINDING.json', {at: new Date().toISOString(), source, harness, driverSha256: sha(JSON.stringify(seal)), candidate: seal.candidate, tree: seal.tree, packageSha256: json(join(shipping, 'CANDIDATE.json')).expectedPackageSha256, packageRebuilt: false, profileSha256: sha(JSON.stringify(profile)), projectionSha256: sha(JSON.stringify(projection)), files, original35Preserved: true, controlsSha256: sha(controls), fullGatePhases: 0, productionBuilds: 0, independentAcceptance: false});
  const cleanup = [];
  for (const cohort of prepared.filter(item => item.counts === null)) {
    for (const row of cohort.report.rows) for (const root of row.receipt.envelope.roots) {
      assert.match(root.path, /^\/private\/tmp\/unified76-(?:os-write-[A-Za-z0-9]+|build-types-review-protocol-[a-z]+-\d+)$/u);
      const stat = lstatSync(root.path);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      assert.equal(realpathSync(root.path), root.path);
      assert.deepEqual([stat.dev, stat.ino, stat.mode & 0o777, stat.uid], [root.device, root.inode, root.mode, root.uid]);
      assert.equal(stat.uid, process.getuid());
      rmSync(root.path, {recursive: true});
      assert.ok(!existsSync(root.path));
      cleanup.push({cohort: cohort.name, ...root, absent: true});
    }
  }
  save('CLEANUP.json', {at: new Date().toISOString(), removedReceiptBoundRoots: cleanup, signalsSentBySealer: 0, foreignProcessesTouched: false, outerRawEvidencePreserved: true});
  assert.deepEqual(verifyDriverSeal(), seal);
  console.log(JSON.stringify({output, files: captures.reduce((sum, item) => sum + item.files.length, 0), totalRawBytes: total, cleanedRoots: cleanup.length, driverSha256: sha(JSON.stringify(seal))}));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) run();
