import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const started = performance.now();
const exclusions = ['SEAL.json', 'seal.stdout.raw', 'seal.stderr.raw'];
const rows = [];
let total = 0;
const text = async relative => {
  const status = await lstat(root + relative);
  assert(status.isFile() && !status.isSymbolicLink() && status.size <= 1048576);
  return readFile(root + relative, 'utf8');
};
const json = async relative => JSON.parse(await text(relative));
const save = (name, value) => writeFile(root + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
try {
  const closure = await json('CLOSURE-01/CLOSURE.json');
  const cache = await json('AUTHORITY-CACHE-01/CACHE.json');
  const key = await json('KEY-INSPECTION-01/RESULT.json');
  const child = await json('KEY-INSPECTION-01/CHILD.json');
  assert.equal(closure.starts, 3);
  assert.equal(closure.allClosed, true);
  assert.equal(closure.bindings.length, 8);
  assert.equal(cache.selected.length, 15);
  assert.equal(cache.total, 5792334959);
  assert.equal(key.ownedClosed, true);
  assert.equal(key.starts, 1);
  assert.equal(key.verifiedPairs, 0);
  assert.equal(child.disposition.code, 0);
  assert.deepEqual(child.events.map(event => event.event), ['spawn', 'exit', 'close']);
  const publicText = await text('KEY-INSPECTION-01/stdout.raw');
  const publicRecords = publicText.trim().split('\n').map(line => line.split(':'));
  const fingerprints = publicRecords.filter(fields => fields[0] === 'fpr').map(fields => fields[9]);
  assert(fingerprints.length > 0 && fingerprints.every(value => /^[A-F0-9]{40,64}$/.test(value)));
  const dynamicText = await text('KEY-INSPECTION-01/stderr.raw');
  const loadedImages = [];
  const otherDiagnostics = [];
  for (const line of dynamicText.split('\n')) {
    if (!line) continue;
    const match = /^dyld\[\d+\]: <([A-Fa-f0-9-]+)> (.+)$/.exec(line);
    if (match) {
      const path = match[2];
      const external = closure.bindings.find(row => row.path === path || row.resolved === path);
      loadedImages.push({ uuid: match[1], path, classification: external ? 'PINNED_EXTERNAL_IMAGE' : path === '/usr/lib/dyld' ? 'PINNED_DYLD' : path.startsWith('/System/Library/') || path.startsWith('/usr/lib/') ? 'PLATFORM_IMAGE_STATIC_CACHE_SET_BOUND_NOT_INDEPENDENT_IMAGE_EXTRACTION' : 'UNRESOLVED_IMAGE' });
    } else otherDiagnostics.push(line);
  }
  const observations = {
    role: 'PREPARATION_NOT_16_SIGNATURE_ACCEPTANCE',
    linkedPublisherKeySha256: 'db4041b4d3896b9f21250e6c29861958bd5d4781f521f06beda849a9ed79fae8',
    publicKeyFingerprints: fingerprints,
    publicMetadataRecords: publicRecords,
    loadedImages,
    otherDiagnostics,
    loadedImageObservationAvailable: loadedImages.length > 0,
    unresolvedImages: loadedImages.filter(row => row.classification === 'UNRESOLVED_IMAGE'),
    emptyOwnedKeyHome: key.homeEntries.length === 0,
    keyHomeEntries: key.homeEntries,
    metadataChildren: 4,
    allMetadataChildrenClosed: closure.allClosed && key.ownedClosed,
    gpgvVerifications: 0,
    pairsUnrun: 16,
    remainingReason: 'ALL_PROCESS_RESERVATION_CANNOT_FIT_16_PLUS_PREPARATION_AND_PUBLICATION',
    authorityQualification: 'OFFICIAL_PROJECT_ADMIN_LINK_TO_PERSONAL_PUBLIC_KEY_NOT_PROJECT_RELEASE_KEY_REGISTRY_OR_ALL_PATCH_SIGNER_COVERAGE',
  };
  await save('OBSERVATIONS.json', observations);
  const visit = async prefix => {
    for (const name of (await readdir(root + prefix)).sort()) {
      const relative = prefix + name;
      if (exclusions.includes(relative)) continue;
      assert(performance.now() - started < 30000);
      const status = await lstat(root + relative);
      assert(!status.isSymbolicLink());
      if (status.isDirectory()) await visit(relative + '/');
      else {
        assert(status.isFile() && status.size <= 1048576);
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(root + relative, { highWaterMark: 65536 })) digest.update(chunk);
        const captured = relative.includes('-01/') || relative.endsWith('.raw') || relative === 'OBSERVATIONS.json';
        if (captured) assert.equal(status.mode & 0o777, 0o600);
        total += status.size;
        assert(total < 8388608 && rows.length < 160);
        rows.push({ path: relative, bytes: status.size, mode: (status.mode & 0o777).toString(8), sha256: digest.digest('hex'), role: captured ? 'CAPTURED_METADATA_OR_PUBLIC_DATA' : 'AUTHORED_SOURCE' });
      }
    }
  };
  await visit('');
  await save('SEAL.json', { sealedAt: new Date().toISOString(), status: 'SOURCE_DATA_PREPARATION_CHECKS_PASS_NOT_SIGNATURE_ACCEPTANCE', files: rows.length, bytes: total, publicKeyFingerprints: fingerprints, supervisedNativeChildren: 4, gpgvPairsVerified: 0, pairsUnrun: 16, rows, exclusions });
  console.log(JSON.stringify({ files: rows.length, bytes: total, publicKeyFingerprints: fingerprints, observedLoadedImages: loadedImages.length, unresolvedImages: observations.unresolvedImages, keyHomeEntries: key.homeEntries, keyChild: child.disposition, metadataChildren: 4, verifiedPairs: 0, pairsUnrun: 16 }));
  console.log(publicText);
} catch (error) {
  process.exitCode = 1;
  console.error(JSON.stringify({ status: 'STOP', name: error.name, message: error.message }));
}
