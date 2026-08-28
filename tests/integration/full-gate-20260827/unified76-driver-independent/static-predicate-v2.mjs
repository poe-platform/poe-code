import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const prefix = 'tests/integration/full-gate-20260827/unified76-driver/';
const ownedPrefix = 'tests/integration/full-gate-20260827/unified76-driver-independent/';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobIdentity = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

async function readGit(revision, path, collect = true) {
  assert.match(revision, /^[0-9a-f]{40}$/);
  assert(!path.startsWith('/') && !path.split('/').includes('..'));
  const child = spawn('git', ['--no-replace-objects', 'cat-file', 'blob', `${revision}:${path}`], {
    cwd: repository, stdio: ['ignore', 'pipe', 'pipe']
  });
  let failure;
  child.on('error', error => { failure = error; });
  const closed = new Promise(resolveStatus => child.on('close', (code, signal) => resolveStatus({ code, signal })));
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const hash = createHash('sha256');
  const chunks = [];
  let bytes = 0;
  let errorBytes = 0;
  child.stderr.on('data', chunk => { errorBytes += chunk.length; });
  try {
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      assert(bytes <= (collect ? 524288 : 2097152), 'bounded pinned blob read');
      hash.update(chunk);
      if (collect) chunks.push(chunk);
    }
    const result = await closed;
    if (failure) throw failure;
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(errorBytes, 0);
    return { bytes, sha256: hash.digest('hex'), content: collect ? Buffer.concat(chunks) : null };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
}

export function metadataPredicate(subject, trusted, selectedBase, trustedRoute) {
  if (subject.entry.path !== trusted.path || subject.entry.classification !== trusted.classification) return 'REJECT_CLASSIFICATION';
  if (subject.entry.inventorySha256 !== trusted.inventorySha256) return 'REJECT_INVENTORY_RECORD';
  if (trusted.classification === 'current') {
    if (subject.entry.group !== trusted.group || subject.route.group !== trustedRoute.group ||
        !subject.route.files.includes(trusted.path) || JSON.stringify(subject.route.runtime) !== JSON.stringify(trustedRoute.runtime)) return 'REJECT_CURRENT_ROUTE';
  } else if (subject.observed.sha256 !== trusted.inventorySha256) return 'REJECT_NONCURRENT_HASH';
  if (subject.observed.revision !== selectedBase) return 'REJECT_SELECTED_REVISION';
  if (subject.observed.gitBlob !== trusted.gitBlob) return 'REJECT_SELECTED_BLOB';
  if (subject.observed.sha256 !== trusted.actualSha256) return 'REJECT_SELECTED_DIGEST';
  return 'ACCEPT_BASE_METADATA';
}

export async function verifyStaticMetadata() {
  const fixture = JSON.parse(readFileSync(resolve(directory, 'AUTHORITY-v2.json')));
  const revisions = fixture.revisions;
  assert.equal(revisions.finalCandidate, null);
  assert.equal(revisions.finalDriver, null);
  const sources = new Map();
  for (const source of fixture.sources) {
    assert(!sources.has(source.id));
    const read = await readGit(revisions[source.revision], source.path);
    assert.equal(read.sha256, source.sha256, source.path);
    sources.set(source.id, source.path.endsWith('.json') ? JSON.parse(read.content) : read.content.toString());
  }
  for (const name of ['PHASE-A.json', 'PHASE-B.json', 'RECEIPT.md', 'integrityvalidation.mjs']) {
    const historical = await readGit(name === 'PHASE-A.json' ? revisions.phaseA : revisions.phaseB, ownedPrefix + name);
    assert.deepEqual(readFileSync(resolve(directory, name)), historical.content, `original history unchanged: ${name}`);
  }
  const authority = sources.get('authority');
  const inventory = sources.get('inventory');
  assert.equal(authority.base, revisions.base);
  assert.equal(authority.candidate, revisions.supersededPacket);
  assert.equal(authority.checker.sha256, fixture.sources.find(source => source.id === 'checker').sha256);
  assert.equal(authority.checker.introducedPolicyRevision, revisions.checkerPolicyIntroduction);
  const noncurrentRule = 'if (entry.classification !== "current") assert.equal(sha256(read(entry.path)), entry.sha256';
  assert(sources.get('checker').includes(noncurrentRule));
  const initialChecker = await readGit(revisions.checkerPolicyIntroduction, authority.checker.path);
  assert(initialChecker.content.toString().includes(noncurrentRule));
  assert.equal(authority.rows.length, 192);
  assert.equal(new Set(authority.rows.map(row => row.path)).size, 192);
  assert.deepEqual(authority.rows.map(row => row.path).sort(), inventory.entries.map(entry => entry.path).sort());
  for (const row of authority.rows) {
    const entry = inventory.entries.find(item => item.path === row.path);
    assert.equal(row.classification, entry.classification);
    assert.equal(row.recordedInventorySha256, entry.sha256);
    assert.equal(row.hashFieldEnforcedBySelectedChecker, entry.classification !== 'current');
  }
  const current = fixture.f01.current;
  const providerRow = authority.rows.find(row => row.path === current.path);
  assert.equal(providerRow.group, current.group);
  assert.equal(providerRow.selectedGitBlob, current.gitBlob);
  assert.equal(providerRow.selectedSourceSha256, current.actualSha256);
  const routeLine = sources.get('routes').split('\n').find(line => line.includes('group("webdav-loopback",'));
  const routeMatch = routeLine.match(/group\("webdav-loopback", "([^"]+)", (\[[^\]]+\]), (\[[^\]]+\])/u);
  assert(routeMatch);
  const routeFiles = JSON.parse(routeMatch[2]).map(name => `${routeMatch[1]}/${name}`);
  assert.deepEqual(routeFiles, fixture.f01.route.files);
  assert.deepEqual(JSON.parse(routeMatch[3]), fixture.f01.route.runtime);
  assert(sources.get('routes').includes('files: files.map(file => `${directory}/${file}`)'));
  const companion = sources.get('routes').split('\n').find(line => line.includes('group("webdav-timestamp-independent",'));
  assert(companion.includes(`companions: ["${current.path}"]`) && companion.includes('nodeTests: 23'));
  const dispatch = sources.get('dispatch');
  assert(dispatch.includes('const inputs = [...group.files, ...group.companions ?? []]'));
  assert(dispatch.includes('for (const runtime of group.runtime)'));
  assert(dispatch.includes('if (group.name === "webdav-loopback") assert.equal(counts.tests, 13)'));
  for (const lineage of authority.lineage) {
    const read = await readGit(lineage.revision, current.path);
    assert.equal(read.sha256, lineage.sha256);
    assert.equal(blobIdentity(read.content), lineage.gitBlob);
    assert.equal(read.bytes, lineage.bytes);
  }
  for (const trusted of [current, fixture.f01.noncurrentControl]) {
    const read = await readGit(revisions.base, trusted.path);
    assert.equal(read.sha256, trusted.actualSha256);
    assert.equal(blobIdentity(read.content), trusted.gitBlob);
    const entry = inventory.entries.find(item => item.path === trusted.path);
    assert.equal(entry.classification, trusted.classification);
    assert.equal(entry.sha256, trusted.inventorySha256);
    if (trusted.classification === 'current') assert.equal(entry.group, trusted.group);
  }
  const seal = sources.get('driverSeal');
  const author = sources.get('authorEvidence');
  assert.equal(author.driverCommit, revisions.driver);
  assert.equal(author.candidate, revisions.supersededPacket);
  assert.equal(sha256(JSON.stringify(seal)), author.driverSha256);
  assert.equal(author.driverSha256, fixture.packetBoundary.driverSealCanonicalJsonSha256);
  assert.equal(Object.keys(seal.files).length, 11);
  for (const [name, expected] of Object.entries(seal.files)) {
    const read = await readGit(revisions.driver, prefix + name, name !== 'PROFILE.json.gz.base64');
    assert.equal(read.sha256, expected, name);
  }
  const raw = await readGit(revisions.authority, prefix + 'RAW.json.gz.base64', false);
  assert.equal(raw.sha256, author.raw.encodedSha256);
  assert.equal(raw.sha256, fixture.packetBoundary.rawEncodedSha256);
  const results = [];
  assert.equal(fixture.staticControls.length, 10);
  assert.equal(new Set(fixture.staticControls.map(control => control.id)).size, 10);
  for (const control of fixture.staticControls) {
    const trusted = control.fixture === 'current' ? current : fixture.f01.noncurrentControl;
    const subject = {
      entry: structuredClone(trusted), route: structuredClone(fixture.f01.route),
      observed: { revision: revisions.base, gitBlob: trusted.gitBlob, sha256: trusted.actualSha256 }
    };
    switch (control.mutation) {
      case 'none': break;
      case 'wrong-current-group': subject.entry.group = 'webdav-services'; break;
      case 'omit-provider-from-route': subject.route.files = subject.route.files.filter(path => path !== current.path); break;
      case 'wrong-selected-git-blob': subject.observed.gitBlob = '0'.repeat(40); break;
      case 'use-old-inventory-sha-as-actual-bytes': subject.observed.sha256 = current.inventorySha256; break;
      case 'use-superseded-candidate-as-present-base': subject.observed.revision = revisions.supersededPacket; break;
      case 'wrong-noncurrent-byte-hash': subject.observed.sha256 = '0'.repeat(64); break;
      case 'rewrite-noncurrent-recorded-hash': subject.entry.inventorySha256 = '0'.repeat(64); break;
      case 'reclassify-as-current': subject.entry.classification = 'current'; break;
      default: throw new Error(`Unknown static mutation ${control.mutation}`);
    }
    const actual = metadataPredicate(subject, trusted, revisions.base, fixture.f01.route);
    assert.equal(actual, control.expected, control.id);
    results.push({ id: control.id, verdict: actual });
  }
  return {
    status: 'F01_BASE_METADATA_AUTHORITY_RESOLVED_ONLY', finalCandidate: 'HOLD_NEW_PACKET',
    originalStaticExit1Retained: true, frozenDriverGroups: '22 NOT_EXECUTED',
    staticToolNode: process.version, staticPredicateControls: results,
    pinnedDriverFileHashesMatched: 11, historicalArtifactsUnchanged: 4,
    authorityRowMembership: 192, independentlyCheckedCurrentRoutes: ['webdav-loopback', 'webdav-timestamp-independent companion'],
    qualification: 'Pure independent metadata predicates and read-only evidence hashes only; no author module imported, admission or reconstruction invoked, or runtime result replayed.',
    authorOutcomesNotIndependent: { controls: author.controls, inventory: author.inventory, packageControls: author.packageControls },
    encodedRawBytesHashedWithoutDecoding: raw.bytes, archiveBytesRead: 0
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--verify') {
    console.error('Usage: node static-predicate-v2.mjs --verify (independent static metadata only)');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await verifyStaticMetadata(), null, 2)); }
    catch (error) { console.error(error); process.exitCode = 1; }
  }
}
