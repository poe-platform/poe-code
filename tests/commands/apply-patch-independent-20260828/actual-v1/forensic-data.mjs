import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const oid = (kind, bytes) => crypto.createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const metadataBytes = fs.readFileSync(path.join(own, 'METADATA.json'));
const metadata = JSON.parse(metadataBytes);
const finalBytes = fs.readFileSync(path.join(own, 'FINAL.json'));
const final = JSON.parse(finalBytes);
assert.equal(final.executedJobs, 2);
assert.equal(final.product.length, 0);
assert.equal(final.cleanup.ownedRootRemoved, true);
function stdout(stem) {
  const receipt = JSON.parse(fs.readFileSync(path.join(own, 'evidence', `${stem}.json`)));
  const fragments = receipt.fragments.filter(fragment => fragment.name.includes('-stdout-')).map(fragment => {
    const data = JSON.parse(fs.readFileSync(path.join(own, 'evidence', fragment.name)));
    const bytes = Buffer.from(data.base64, 'base64');
    assert.equal(bytes.length, fragment.bytes); assert.equal(hash(bytes), fragment.sha256);
    return { ...data, bytes };
  }).sort((left, right) => left.offset - right.offset);
  let offset = 0;
  for (const fragment of fragments) { assert.equal(fragment.offset, offset); offset += fragment.bytes.length; }
  const bytes = Buffer.concat(fragments.map(fragment => fragment.bytes));
  assert.equal(hash(bytes), receipt.stdoutSha256);
  return bytes;
}
function unquote(display) {
  if (!display.startsWith('"')) return Buffer.from(display);
  assert.ok(display.endsWith('"'));
  const output = [];
  const escaped = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let index = 1; index < display.length - 1; index++) {
    if (display[index] !== '\\') { assert.ok(display.charCodeAt(index) < 128); output.push(display.charCodeAt(index)); continue; }
    const next = display[++index];
    if (Object.hasOwn(escaped, next)) output.push(escaped[next]);
    else {
      const octal = display.slice(index, index + 3); assert.match(octal, /^[0-7]{3}$/);
      output.push(parseInt(octal, 8)); index += 2;
    }
  }
  return Buffer.from(output);
}
function canonical(entries) {
  const root = new Map();
  for (const entry of entries) {
    const components = [];
    let start = 0;
    for (let index = 0; index <= entry.path.length; index++) if (index === entry.path.length || entry.path[index] === 47) { components.push(entry.path.subarray(start, index)); start = index + 1; }
    let current = root;
    for (const component of components.slice(0, -1)) {
      const key = component.toString('hex');
      if (!current.has(key)) current.set(key, { name: component, children: new Map() });
      current = current.get(key).children; assert.ok(current instanceof Map);
    }
    const name = components.at(-1); const key = name.toString('hex');
    assert.equal(current.has(key), false); current.set(key, { ...entry, name });
  }
  function visit(directory) {
    const entries = [...directory.values()].map(entry => entry.children ? { name: entry.name, mode: '40000', blob: visit(entry.children), directory: true } : { ...entry, mode: parseInt(entry.mode, 8).toString(8), directory: false });
    entries.sort((left, right) => Buffer.compare(Buffer.concat([left.name, left.directory ? Buffer.from('/') : Buffer.alloc(0)]), Buffer.concat([right.name, right.directory ? Buffer.from('/') : Buffer.alloc(0)])));
    const payload = Buffer.concat(entries.map(entry => Buffer.concat([Buffer.from(entry.mode + ' '), entry.name, Buffer.from([0]), Buffer.from(entry.blob, 'hex')])));
    return oid('tree', payload);
  }
  return visit(root);
}
const captured = stdout('002-git-authenticated-inputs');
let offset = 0;
const objects = [];
while (offset < captured.length) {
  const newline = captured.indexOf(10, offset);
  const [objectId, kind, sizeText] = captured.subarray(offset, newline).toString().split(' ');
  const size = Number(sizeText); assert.ok(Number.isSafeInteger(size) && size >= 0);
  const payload = captured.subarray(newline + 1, newline + 1 + size);
  assert.equal(oid(kind, payload), objectId); assert.equal(captured[newline + 1 + size], 10);
  objects.push({ objectId, kind, payload }); offset = newline + size + 2;
}
assert.equal(objects[1].objectId, metadata.candidate);
const committedTree = objects[1].payload.toString().split('\n')[0].slice(5);
const displayed = metadata.candidateTrackedInventory.trimEnd().split('\n').map(line => {
  const tab = line.indexOf('\t'); const [mode, type, blob] = line.slice(0, tab).split(' ');
  return { mode, type, blob, display: line.slice(tab + 1) };
});
const malformedTree = canonical(displayed.map(entry => ({ ...entry, path: Buffer.from(entry.display) })));
const decodedTree = canonical(displayed.map(entry => ({ ...entry, path: unquote(entry.display) })));
assert.equal(malformedTree, 'bd69c1a1dd0e65e442017ab27f86ed72a284fa95');
assert.equal(decodedTree, committedTree);
const source = metadata.sourceEntries.map(entry => {
  const object = objects.find(object => object.objectId === entry.blob);
  assert.ok(object); assert.equal(hash(object.payload), entry.sha256); assert.equal(object.payload.length, entry.bytes);
  const live = fs.readFileSync(path.join(repository, entry.path));
  return { path: entry.path, candidateBlob: object.objectId, committedSha256: hash(object.payload), livePostSha256: hash(live), livePostMatchesCommitted: hash(live) === entry.sha256 };
});
const archive = Buffer.from(fs.readFileSync(path.join(own, final.archive.path), 'utf8').trim(), 'base64');
assert.equal(hash(archive), final.archive.sha256);
const archiveContents = JSON.parse(gunzipSync(archive));
assert.deepEqual(Object.keys(archiveContents.files), []);
assert.deepEqual(Object.keys(archiveContents.inventory), ['home/', 'tmp/']);
const captureInventory = fs.readdirSync(path.join(own, 'evidence')).sort().map(name => {
  const filename = path.join(own, 'evidence', name); const stat = fs.lstatSync(filename); assert.ok(stat.isFile());
  return { path: `evidence/${name}`, bytes: stat.size, mode: stat.mode & 0o777, sha256: hash(fs.readFileSync(filename)) };
});
const result = {
  schema: 'apply-patch-actual-v1-failed-admission-forensic-data', observedAt: new Date().toISOString(),
  classification: 'DATA-only diagnosis of preserved stopped attempt; NOT a retry, admission, product execution or corrected semantic result',
  metadataSha256: hash(metadataBytes), finalSha256: hash(finalBytes),
  candidate: metadata.candidate, entryCount: displayed.length, quotedPathCount: displayed.filter(entry => entry.display.startsWith('"')).length,
  committedTree, malformedDisplayNameTree: malformedTree, decodedRawNameTree: decodedTree,
  rootCause: 'capture-metadata.mjs uses non-NUL git ls-tree display output; controller parses quoted path display strings as literal path bytes.98 C-quoted names therefore yield a different reconstructed tree.',
  proposedFutureRepairNotApplied: 'Authenticate NUL-delimited raw pathname bytes throughout candidate inventory; independently qualify byte-name tree controls before a separately authorized future execution. Do not rerun this stopped attempt.',
  source, sourceQualification: 'Committed candidate bytes authenticated from preserved Git capture and compared with live post-stop six-module bytes. No before-live census was taken; not a proof of the entire live workspace being unchanged.',
  controls: { finiteOwnData: 20, exactReasonIdentities: 5, productPasses: 0, loaderControls: 0 },
  archiveVerified: true, ownedWorkAbsent: !fs.existsSync(path.join(own, '.work-v1')),
  captureInventory, captureInventorySha256: hash(JSON.stringify(captureInventory)), persistedCaptureBytes: captureInventory.reduce((total, entry) => total + entry.bytes, 0),
  subprocessesDuringThisForensicCheck: 0,
};
const text = JSON.stringify(result, null, 2);
console.log(`*** Begin Patch\n*** Add File: tests/commands/apply-patch-independent-20260828/actual-v1/FORENSICS.json\n${text.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch`);
