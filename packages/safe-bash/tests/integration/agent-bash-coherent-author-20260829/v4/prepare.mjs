import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(own, '../../../..');
const phase = process.argv[2];
assert.ok(['--adjudicate', '--seal'].includes(phase));
const log = fs.openSync(path.join(own, 'capture', phase.slice(2) + '.events.jsonl'), 'wx');
const note = value => fs.writeSync(log, JSON.stringify(value) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const gitOid = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const oldScope = 'tests/integration/agent-bash-coherent-author-20260829/';
const expectedHash = '6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b';
const observedHash = '298fce206c0c4abf5a9960e9140d5b430267cf9819089a0bbfbb3936af9dabbc';
let children = 0;
function put(name, value) { fs.writeFileSync(path.join(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function read(filename, maximum = 1048576, expected) {
  assert.ok(!filename.split('/').includes('AGENTS.md'));
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum);
  if (expected) assert.equal(before.size, expected.bytes);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const initial = fs.fstatSync(descriptor); assert.equal(initial.ino, before.ino); assert.equal(initial.dev, before.dev);
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset); assert.ok(count > 0); offset += count; }
    const after = fs.fstatSync(descriptor); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
    if (expected) assert.equal(sha(bytes), expected.sha256);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
async function tool(filename, digest) {
  const before = fs.lstatSync(filename); assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 134217728);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of fs.createReadStream(filename)) { bytes += chunk.length; assert.ok(bytes <= before.size); hash.update(chunk); }
  const after = fs.lstatSync(filename); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(bytes, before.size); assert.equal(hash.digest('hex'), digest);
  return { path: filename, bytes, sha256: digest };
}
function git(args, input, maximum = 4194304) {
  const prefix = path.join(own, 'capture', phase.slice(2) + '-git-' + children++);
  const stdout = fs.openSync(prefix + '.stdout', 'wx'), stderr = fs.openSync(prefix + '.stderr', 'wx'); let result;
  try { result = spawnSync('/usr/bin/git', args, { cwd: repo, input, stdio: ['pipe', stdout, stderr], timeout: 15000, env: { PATH: '/usr/bin:/bin', HOME: '/tmp', GIT_OPTIONAL_LOCKS: '0' } }); }
  finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  note({ pid: result.pid, role: 'DEVELOPMENT_GIT_METADATA', args, status: result.status, signal: result.signal, error: result.error?.code });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null);
  return read(prefix + '.stdout', maximum);
}
function fetch(requests) {
  const modes = new Map();
  for (const commit of [...new Set(requests.map(row => row.commit))]) {
    const paths = requests.filter(row => row.commit === commit).map(row => row.path);
    const raw = git(['ls-tree', '-z', commit, '--', ...paths], undefined, 131072);
    for (const record of raw.toString().split('\0').filter(Boolean)) {
      const match = /^(100644) blob ([0-9a-f]{40})\t([^\0]+)$/.exec(record); assert.ok(match);
      modes.set(commit + ':' + match[3], { mode: match[1], blob: match[2] });
    }
  }
  const references = requests.map(row => row.commit + ':' + row.path);
  assert.equal(modes.size, references.length);
  const metadata = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], references.join('\n') + '\n', 131072).toString().trimEnd().split('\n');
  assert.equal(metadata.length, references.length);
  const rows = metadata.map((line, index) => {
    const match = /^([0-9a-f]{40}) blob ([0-9]+)$/.exec(line); assert.ok(match);
    const bytes = Number(match[2]); assert.ok(Number.isSafeInteger(bytes) && bytes <= 1048576);
    assert.equal(match[1], modes.get(references[index]).blob);
    return { ...requests[index], reference: references[index], blob: match[1], mode: '100644', bytes };
  });
  const bound = rows.reduce((sum, row) => sum + row.bytes + 128, 0); assert.ok(bound <= 4194304);
  const packed = git(['cat-file', '--batch'], rows.map(row => row.blob).join('\n') + '\n', bound);
  let cursor = 0; const result = new Map();
  for (const row of rows) {
    const end = packed.indexOf(10, cursor); assert.equal(packed.subarray(cursor, end).toString(), `${row.blob} blob ${row.bytes}`);
    const bytes = packed.subarray(end + 1, end + row.bytes + 1); assert.equal(bytes.length, row.bytes); assert.equal(gitOid('blob', bytes), row.blob); assert.equal(packed[end + row.bytes + 1], 10);
    result.set(row.path, { ...row, sha256: sha(bytes), body: bytes }); cursor = end + row.bytes + 2;
  }
  assert.equal(cursor, packed.length); return result;
}
function intendedFromPatch(patch) {
  const prefix = '*** Begin Patch\n*** Add File: ' + oldScope + 'v3/workflows.mjs\n', suffix = '*** End Patch\n';
  const text = patch.toString('utf8'); assert.ok(Buffer.from(text).equals(patch));
  assert.ok(text.startsWith(prefix) && text.endsWith(suffix));
  const body = text.slice(prefix.length, -suffix.length); assert.ok(body.endsWith('\n'));
  const lines = body.slice(0, -1).split('\n'); assert.ok(lines.every(line => line.startsWith('+')));
  const intended = Buffer.from(lines.map(line => line.slice(1)).join('\n'));
  const lineMaterialization = Buffer.from(lines.map(line => line.slice(1) + '\n').join(''));
  return { intended, lineMaterialization, addedLines: lines.length };
}
function terminalLF(bytes) { let count = 0; while (count < bytes.length && bytes[bytes.length - count - 1] === 10) count++; return count; }
try {
  note({ started: new Date().toISOString(), pid: process.pid, parent: process.ppid, phase, productExecutions: 0 });
  const node = await tool('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  assert.equal(process.execPath, node.path); assert.equal(process.version, 'v22.22.2');
  const developmentGit = await tool('/usr/bin/git', '12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba');
  if (phase === '--adjudicate') {
    const names = ['v3/workflows.mjs','v3/WORKFLOW.patch','v3/finish.mjs','v3/EXPECTATION-DELTA.json','v3/HANDOFF.md'];
    const base = ['v2/workflows.mjs','v2/SOURCE.json','v2/EXECUTABLE-PRESEAL.json','v2/ADMISSION-CONTROLS.json','v2/workflow-entry.mjs','v2/admission.mjs'];
    const records = fetch([...names.map(name => ({ commit: 'aed62f65', path: oldScope + name })), ...base.map(name => ({ commit: 'cf23ba11', path: oldScope + name }))]);
    const record = name => records.get(oldScope + name);
    const actual = record('v3/workflows.mjs'); assert.equal(actual.sha256, observedHash);
    const materialized = read(path.join(repo, actual.path), 1048576, actual); assert.ok(materialized.equals(actual.body));
    const patch = record('v3/WORKFLOW.patch');
    const { intended, lineMaterialization, addedLines } = intendedFromPatch(patch.body);
    assert.equal(sha(intended), expectedHash);
    const delta = JSON.parse(record('v3/EXPECTATION-DELTA.json').body); assert.equal(delta.successor, expectedHash); assert.equal(delta.prior, record('v2/workflows.mjs').sha256);
    const generator = record('v3/finish.mjs').body.toString();
    const operation = "corrected.split('\\n').map(line=>'+'+line).join('\\n')";
    assert.ok(generator.includes(operation));
    const common = Math.min(intended.length, materialized.length); let firstDifference = 0;
    while (firstDifference < common && intended[firstDifference] === materialized[firstDifference]) firstDifference++;
    const intendedLF = terminalLF(intended), actualLF = terminalLF(materialized);
    const intendedBody = intended.subarray(0, intended.length - intendedLF), actualBody = materialized.subarray(0, materialized.length - actualLF);
    const eligible = intendedLF > 0 && actualLF === intendedLF + 1 && intendedBody.equals(actualBody) && materialized.equals(lineMaterialization) && materialized.subarray(0, intended.length).equals(intended) && materialized.length === intended.length + 1 && materialized.at(-1) === 10;
    const adjudication = { role: 'EXACT_BYTE_ADJUDICATION_NOT_RUNTIME', eligible, intended: { bytes: intended.length, sha256: sha(intended), derivedBlob: gitOid('blob', intended), storedObjectClaim: false, terminalLF: intendedLF }, committed: { ...actual, body: undefined, terminalLF: actualLF }, materialized: { bytes: materialized.length, sha256: sha(materialized), equalsCommitted: true }, firstDifference, identicalPrefixBytes: firstDifference, extraBytesHex: materialized.subarray(intended.length).toString('hex'), identicalNonterminalSha256: sha(intendedBody), nonterminalEndsWith: intendedBody.subarray(-1).toString(), generator: { reference: record('v3/finish.mjs').reference, blob: record('v3/finish.mjs').blob, sha256: record('v3/finish.mjs').sha256, operation, addedLines, modelByteMatchesCommitted: materialized.equals(lineMaterialization) }, qualification: 'No trim/normalization applied to either observed input. Exact equality outside the terminal LF suffix; no token bytes differ. No parser/product/native execution.' };
    put('ADJUDICATION.json', adjudication);
    put('AUTHORITIES.json', [...records.values()].map(({ body, ...row }) => row));
    if (!eligible) { process.exitCode = 78; console.log(JSON.stringify({ eligible, correctionGenerated: false })); }
    else {
      const text = intended.toString('utf8'); assert.ok(Buffer.from(text).equals(intended)); assert.ok(text.endsWith('\n'));
      const lines = text.split('\n'); assert.equal(lines.pop(), '');
      const destination = path.relative(repo, path.join(own, 'workflows.mjs'));
      const correctedPatch = '*** Begin Patch\n*** Add File: ' + destination + '\n' + lines.map(line => '+' + line).join('\n') + '\n*** End Patch\n';
      fs.writeFileSync(path.join(own, 'CORRECTION.patch'), correctedPatch, { flag: 'wx' });
      put('CORRECTION-PLAN.json', { expectedBytes: intended.length, expectedSha256: expectedHash, expectedDerivedBlob: gitOid('blob', intended), patchSha256: sha(Buffer.from(correctedPatch)), change: 'Remove only the artificial split sentinel from patch line serialization; preserve every intended byte and intended terminal LF.', priorUnrun: 'aed62f65:v3/workflows.mjs; STOP unchanged', productChanges: 0 });
      console.log(JSON.stringify({ eligible, intendedBytes: intended.length, committedBytes: materialized.length, firstDifference, extraBytesHex: adjudication.extraBytesHex, expectedSha256: expectedHash, correctionGenerated: true }));
    }
    put('TOOLS.json', { node, developmentGit });
    git(['diff', '--cached', '--name-only', '-z'], undefined, 131072);
  } else {
    const authorities = JSON.parse(read(path.join(own, 'AUTHORITIES.json')));
    const authority = name => {
      const matches = authorities.filter(row => row.path === oldScope + name);
      assert.equal(matches.length, 1); return matches[0];
    };
    const authenticated = name => read(path.join(repo, oldScope, name), 1048576, authority(name));
    const adjudication = JSON.parse(read(path.join(own, 'ADJUDICATION.json')));
    assert.equal(adjudication.eligible, true);
    const { intended, lineMaterialization } = intendedFromPatch(authenticated('v3/WORKFLOW.patch'));
    assert.equal(intended.length, 15763); assert.equal(sha(intended), expectedHash);
    const previous = authenticated('v3/workflows.mjs');
    assert.equal(sha(previous), observedHash); assert.ok(previous.equals(lineMaterialization));
    const corrected = read(path.join(own, 'workflows.mjs'), 1048576, { bytes: 15763, sha256: expectedHash });
    assert.ok(corrected.equals(intended));
    const sourceBytes = authenticated('v2/SOURCE.json');
    assert.equal(sha(sourceBytes), 'ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae');
    const source = JSON.parse(sourceBytes);
    assert.equal(source.computedTree, '3adc676a0ab638c9788ef007e465931d65d2c6fe');
    assert.equal(source.inputs.length, 309);
    const predecessor = JSON.parse(authenticated('v2/EXECUTABLE-PRESEAL.json'));
    const fixtureFiles = predecessor.files.map(row => {
      assert.ok(/^[A-Za-z0-9_.-]+$/.test(row.path));
      const filename = path.join(repo, oldScope, 'v2', row.path);
      read(filename, 1048576, row);
      return row.path === 'workflows.mjs'
        ? { path: path.relative(repo, path.join(own, 'workflows.mjs')), bytes: corrected.length, sha256: sha(corrected) }
        : { ...row, path: path.relative(repo, filename) };
    });
    assert.equal(fixtureFiles.filter(row => row.path.endsWith('/v4/workflows.mjs')).length, 1);
    authenticated('v2/ADMISSION-CONTROLS.json');
    authenticated('v2/workflow-entry.mjs'); authenticated('v2/admission.mjs');
    const names = ['prepare.mjs', 'outer.sh', 'HANDOFF.md', 'ADJUDICATION.json', 'AUTHORITIES.json', 'CORRECTION-PLAN.json', 'CORRECTION.patch', 'TOOLS.json'];
    const packetFiles = names.map(name => {
      const bytes = read(path.join(own, name));
      return { path: path.relative(repo, path.join(own, name)), bytes: bytes.length, sha256: sha(bytes) };
    });
    const preseal = {
      role: 'SOURCE_FIXTURE_PRESEAL_NOT_EXECUTION_READY',
      sourceTree: source.computedTree, sourceManifestSha256: sha(sourceBytes), sourceInputCount: 309,
      sourceChanged: false, predictedPackageMembers: 1014, actualPackageSha256: null,
      fixtureFiles, packetFiles, planned: predecessor.planned, proposedActual: predecessor.proposedActual,
      inheritedDataControls: { count: 12, rerun: false, authority: authority('v2/ADMISSION-CONTROLS.json') },
      tools: { node, developmentGit },
      correction: { expectedSha256: expectedHash, bytes: corrected.length, exactIntendedBufferEquality: true, historicalActualSha256: observedHash, historicalStopUnchanged: true },
      public95: 'EXTERNAL_HANDOFF_PENDING_POINCARE_NO_DISCOVERY',
      blockers: ['Integrated bounded product supervisor/capture/teardown controls not implemented', 'Complete staged retained-helper/import and mutation/restore dispatch not sealed', 'PUBLIC95 exact closure pending Poincare for five separate workflows', 'Build/full package and actual membership UNRUN; 1014 remains prediction', 'Maintained smoke selector writepaths remain proposal only'],
      runAuthority: 'NONE: all eighteen workflows UNRUN; no build/compiler/product/Worker/engine/native/private execution'
    };
    put('PRESEAL.json', preseal);
    const sealedBytes = read(path.join(own, 'PRESEAL.json'));
    const result = { role: 'SOURCE_DATA_ONLY', fixtureEquality: true, presealSha256: sha(sealedBytes), presealBytes: sealedBytes.length, workflowSha256: sha(corrected), sourceInputCount: 309, productExecutions: 0, newDataControlExecutions: 0, children, finished: new Date().toISOString(), executionReady: false };
    put('RESULT.json', result); console.log(JSON.stringify(result));
  }
  note({ finished: new Date().toISOString(), children, productExecutions: 0, exitCode: process.exitCode ?? 0 });
} catch (error) { note({ error: String(error?.stack ?? error), children, productExecutions: 0 }); process.exitCode = 78; }
finally { fs.closeSync(log); }
