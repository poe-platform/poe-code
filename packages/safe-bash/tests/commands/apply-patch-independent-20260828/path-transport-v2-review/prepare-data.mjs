import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(own, '../../../..');
const prefix = 'tests/commands/apply-patch-independent-20260828';
const candidate = '58be2d6c5706f3e90f01d48e695ecfd9daa52669';
const authenticatedRoot = '189bef24a927241d7c47a662f1ac447b56da1835';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const objectId = (kind, body) => crypto.createHash('sha1').update(`${kind} ${body.length}\0`).update(body).digest('hex');
const read = name => fs.readFileSync(path.join(root, prefix, name));
const metadata = JSON.parse(read('actual-v1/METADATA.json'));
const forensic = JSON.parse(read('actual-v1/FORENSICS.json'));
const gitCalls = [];
function git(args) {
  assert.ok(gitCalls.length < 3);
  const body = execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], {
    cwd: root, timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
  gitCalls.push({ args, bytes: body.length, sha256: sha256(body), classification: 'developmentGitmetadata preparation only' });
  return body;
}
function parseRaw(body) {
  if (body.length === 0) return [];
  assert.equal(body.at(-1), 0);
  const entries = [];
  let start = 0;
  while (start < body.length) {
    const end = body.indexOf(0, start);
    const tab = body.indexOf(9, start);
    assert.ok(end > start && tab > start && tab < end);
    const header = body.subarray(start, tab).toString('ascii');
    assert.ok(body.subarray(start, tab).equals(Buffer.from(header, 'ascii')));
    const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40})$/.exec(header);
    assert.ok(match, header);
    assert.equal(match[2], match[1] === '160000' ? 'commit' : 'blob');
    entries.push({ mode: match[1], type: match[2], oid: match[3], pathHex: body.subarray(tab + 1, end).toString('hex') });
    start = end + 1;
  }
  return entries;
}
function canonical(entries, keepPayload = false) {
  const directories = new Map([['', []]]);
  const leaves = new Set();
  for (const entry of entries) {
    const name = Buffer.from(entry.pathHex, 'hex');
    assert.ok(name.length && !name.includes(0));
    const components = [];
    let start = 0;
    for (let cursor = 0; cursor <= name.length; cursor++) {
      if (cursor !== name.length && name[cursor] !== 47) continue;
      const component = name.subarray(start, cursor);
      assert.ok(component.length && !component.equals(Buffer.from('.')) && !component.equals(Buffer.from('..')));
      components.push(component.toString('hex'));
      start = cursor + 1;
    }
    let parent = '';
    for (const component of components.slice(0, -1)) {
      const key = parent + '/' + component;
      assert.ok(!leaves.has(key));
      if (!directories.has(key)) {
        directories.set(key, []);
        directories.get(parent).push({ nameHex: component, mode: '40000', child: key });
      }
      parent = key;
    }
    const leafKey = parent + '/' + components.at(-1);
    assert.ok(!leaves.has(leafKey) && !directories.has(leafKey));
    leaves.add(leafKey);
    directories.get(parent).push({ nameHex: components.at(-1), mode: entry.mode, oid: entry.oid });
  }
  const results = new Map();
  for (const key of [...directories.keys()].sort((left, right) => right.split('/').length - left.split('/').length)) {
    const children = directories.get(key);
    children.sort((left, right) => {
      const leftName = Buffer.from(left.nameHex, 'hex');
      const rightName = Buffer.from(right.nameHex, 'hex');
      for (let cursor = 0; cursor <= Math.min(leftName.length, rightName.length); cursor++) {
        const leftByte = cursor < leftName.length ? leftName[cursor] : left.child === undefined ? 0 : 47;
        const rightByte = cursor < rightName.length ? rightName[cursor] : right.child === undefined ? 0 : 47;
        if (leftByte !== rightByte) return leftByte - rightByte;
      }
      return 0;
    });
    const payload = Buffer.concat(children.map(entry => Buffer.concat([
      Buffer.from(entry.mode + ' '), Buffer.from(entry.nameHex, 'hex'), Buffer.from([0]),
      Buffer.from(entry.child === undefined ? entry.oid : results.get(entry.child).oid, 'hex'),
    ])));
    results.set(key, { oid: objectId('tree', payload), payload, order: children.map(entry => ({ nameHex: entry.nameHex, mode: entry.mode })) });
  }
  const result = results.get('');
  return { oid: result.oid, rootPayload: result.payload, directoryCount: directories.size,
    ...(keepPayload ? { directories: [...results].map(([key, entry]) => ({ componentHexKey: key, oid: entry.oid, payloadHex: entry.payload.toString('hex'), order: entry.order })) } : {}) };
}
function unquoteHistorical(display) {
  assert.ok(display.startsWith('"') && display.endsWith('"'));
  const escapes = new Map([['a', 7], ['b', 8], ['t', 9], ['n', 10], ['v', 11], ['f', 12], ['r', 13], ['"', 34], ['\\', 92]]);
  const bytes = [];
  for (let cursor = 1; cursor < display.length - 1; cursor++) {
    const character = display[cursor];
    if (character !== '\\') { assert.ok(character.charCodeAt(0) < 128); bytes.push(character.charCodeAt(0)); continue; }
    const escaped = display[++cursor];
    if (escapes.has(escaped)) bytes.push(escapes.get(escaped));
    else {
      const octal = display.slice(cursor, cursor + 3);
      assert.match(octal, /^[0-3][0-7]{2}$/);
      bytes.push(Number.parseInt(octal, 8)); cursor += 2;
    }
  }
  return Buffer.from(bytes);
}
function historicalCapture(stem) {
  const receipt = JSON.parse(read(`actual-v1/evidence/${stem}.json`));
  assert.equal(receipt.code, 0); assert.equal(receipt.signal, null); assert.equal(receipt.fault, null);
  assert.equal(receipt.closeObserved, true); assert.equal(receipt.groupAbsent, true);
  const fragments = [];
  let offset = 0;
  for (const reference of receipt.fragments) {
    assert.ok(reference.name.startsWith(stem + '-stdout-'));
    const record = JSON.parse(read(`actual-v1/evidence/${reference.name}`));
    const body = Buffer.from(record.base64, 'base64');
    assert.equal(body.toString('base64'), record.base64);
    assert.equal(record.channel, 'stdout'); assert.equal(record.offset, offset);
    assert.equal(record.totalBytes, receipt.bytes); assert.equal(body.length, reference.bytes);
    assert.equal(sha256(body), record.sha256); assert.equal(record.sha256, reference.sha256);
    fragments.push(body); offset += body.length;
  }
  const body = Buffer.concat(fragments);
  assert.equal(body.length, receipt.bytes); assert.equal(sha256(body), receipt.stdoutSha256);
  assert.equal(receipt.stderrSha256, sha256(Buffer.alloc(0)));
  return { body, fragments: fragments.length, sha256: sha256(body) };
}
const raw = git(['ls-tree', '-rz', '--full-tree', candidate]);
const commitBody = git(['cat-file', 'commit', candidate]);
const storedRootBody = git(['cat-file', 'tree', authenticatedRoot]);
assert.equal(objectId('commit', commitBody), candidate);
assert.equal(commitBody.subarray(0, 46).toString(), `tree ${authenticatedRoot}\n`);
assert.equal(objectId('tree', storedRootBody), authenticatedRoot);
const actualEntries = parseRaw(raw);
assert.equal(actualEntries.length, 50002);
const actualTree = canonical(actualEntries);
assert.equal(actualTree.oid, authenticatedRoot);
assert.ok(actualTree.rootPayload.equals(storedRootBody));
assert.equal(sha256(Buffer.from(metadata.candidateTrackedInventory)), metadata.candidateTrackedInventorySha256);
assert.ok(metadata.candidateTrackedInventory.endsWith('\n'));
const historicalLines = metadata.candidateTrackedInventory.slice(0, -1).split('\n');
assert.equal(historicalLines.length, 50002);
const historicalPaths = historicalLines.map(line => {
  const tab = line.indexOf('\t'); assert.ok(tab > 0);
  const [mode, type, oid] = line.slice(0, tab).split(' ');
  const display = line.slice(tab + 1);
  const rawPath = display.startsWith('"') ? unquoteHistorical(display) : Buffer.from(display);
  return { mode, type, oid, pathHex: rawPath.toString('hex'), displayBase64: Buffer.from(display).toString('base64'), quoted: display.startsWith('"') };
});
for (let index = 0; index < actualEntries.length; index++) {
  const { displayBase64, quoted, ...entry } = historicalPaths[index];
  assert.deepEqual(entry, actualEntries[index]);
}
const actual98 = historicalPaths.filter(entry => entry.quoted).map(({ quoted, ...entry }, index) => ({ id: `H${String(index + 1).padStart(3, '0')}`, ...entry }));
assert.equal(actual98.length, 98);
const baseCapture = historicalCapture('001-git-base-tree');
assert.equal(canonical(parseRaw(baseCapture.body)).oid, metadata.baseManifest.baseTree);
const batchCapture = historicalCapture('002-git-authenticated-inputs');
const batchObjects = [];
let batchOffset = 0;
while (batchOffset < batchCapture.body.length) {
  const newline = batchCapture.body.indexOf(10, batchOffset); assert.ok(newline >= batchOffset);
  const header = batchCapture.body.subarray(batchOffset, newline).toString('ascii');
  const match = /^([0-9a-f]{40}) (commit|tree|blob|tag) (0|[1-9][0-9]*)$/.exec(header); assert.ok(match);
  const size = Number(match[3]); assert.ok(Number.isSafeInteger(size));
  const body = batchCapture.body.subarray(newline + 1, newline + 1 + size);
  assert.equal(body.length, size); assert.equal(batchCapture.body[newline + 1 + size], 10);
  assert.equal(objectId(match[2], body), match[1]);
  batchObjects.push({ oid: match[1], kind: match[2], bytes: body.length, sha256: sha256(body) });
  batchOffset = newline + size + 2;
}
assert.equal(batchOffset, batchCapture.body.length);
assert.equal(batchObjects[1].oid, candidate);
const sourceFiles = [
  ...['capture-metadata.mjs', 'controller.mjs', 'forensic-data.mjs', 'supervisor.mjs', 'deadline.mjs', 'bootstrap.mjs', 'loader.mjs', 'guard-control.mjs', 'worker.mjs'].map(name => 'actual-v1/' + name),
  'admission-plan/capture-inputs.mjs', 'admission-plan/check-data.mjs', 'matrix/check-data-v1.mjs',
];
const dataFiles = [
  ...['REPORT.md', 'FORENSICS.json', 'EXECUTION-SEAL.json', 'METADATA.json', 'FINAL.json', 'EXECUTION-PROFILE.md'].map(name => 'actual-v1/' + name),
  ...['ADMISSION-v1.md', 'BINDING-v1.json', 'INPUTS-v1.json', 'DATA-EXPECTATIONS-v1.json', 'MUTATIONS-v1.json', 'MATRIX-INTERFACE-v1.json', 'HANDOFF-v1.md'].map(name => 'admission-plan/' + name),
  ...['PRESEAL-v1.json', 'ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json', 'LIMITS-v1.json', 'PROTOCOL-v1.json', 'POLICY-v1.json'].map(name => 'matrix/' + name),
];
function descriptor(name) {
  const bytes = read(name); const stat = fs.lstatSync(path.join(root, prefix, name));
  return { path: `${prefix}/${name}`, bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha256(bytes) };
}
const controls = [];
function control(id, family, recipe, input, expected) {
  controls.push({ id, family, recipe, input, expected, candidateExecution: 'NOT_RUN' });
}
const blobBody = Buffer.from('independent path transport control\n');
const blobOid = objectId('blob', blobBody);
const leaf = (name, mode = '100644', oid = blobOid) => ({ pathHex: Buffer.isBuffer(name) ? name.toString('hex') : Buffer.from(name).toString('hex'), mode, type: mode === '160000' ? 'commit' : 'blob', oid });
const record = entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.type} ${entry.oid}\t`), Buffer.from(entry.pathHex, 'hex'), Buffer.from([0])]);
function accepted(id, entries, note, profile = 'raw-bytes') {
  const reference = canonical(entries, true);
  control(id, 'raw-listing', note, { profile, listingBase64: Buffer.concat(entries.map(record)).toString('base64') }, {
    accepted: true, entries, rootOid: reference.oid, directories: reference.directories,
  });
}
for (const entry of actual98) accepted(entry.id, [{ mode: entry.mode, type: entry.type, oid: entry.oid, pathHex: entry.pathHex }], 'Actual historical C-quoted identity, not display bytes. No blob content needed.');
const names = ['plain', ' space', 'space ', ' ', '\t', '\n', 'line\nbreak', 'carriage\rreturn', 'tab\tname', 'back\\slash', '"literal"', 'literal\\n', 'octal\\303\\251', 'café', 'cafe\u0301', '😀', '-leading', ':colon', ':(glob)*', '*?[x]', 'dir/ name\t\n ', '.hidden', 'a//b'];
for (let index = 0; index < names.length - 1; index++) accepted(`P${String(index + 1).padStart(2, '0')}`, [leaf(names[index])], 'Preserve each byte; do not quote-decode, trim, split whitespace, pathspec-expand or normalize.');
accepted('P23', [leaf('café'), leaf('cafe\u0301')], 'NFC and NFD remain distinct leaves.');
accepted('P24', [leaf('a.c'), leaf('a/file'), leaf('a0'), leaf('a-'), leaf('a./child'), leaf('aé'), leaf('Z'), leaf('z')], 'Exact Git directory terminator ordering, not locale, whole-path lexical or directories-first.');
accepted('P25', [leaf('a0'), leaf('a/file'), leaf('a.c')], 'Unsorted listing still canonicalizes to a.c, directory a, a0.');
accepted('P26', [leaf('executable', '100755'), leaf('link', '120000'), leaf('submodule', '160000', candidate), leaf('regular')], 'Preserve executable, symlink and gitlink modes/kinds without reading their contents.');
accepted('P27', [], 'Empty recursive tree is valid; no empty record is present.');
accepted('P28', [leaf(Buffer.from([0x66, 0xff, 0x80]))], 'Byte profile must preserve invalid UTF-8, not replacement characters.');
control('P29', 'profile', 'Same invalid UTF-8 bytes under explicitly strict UTF-8 string profile.', { listingBase64: record(leaf(Buffer.from([0x66, 0xff, 0x80]))).toString('base64'), profile: 'strict-utf8' }, { accepted: false, reason: 'invalid UTF-8; never silently replace' });
control('P30', 'nonrecursive-listing', 'Explicit directory record is valid only in nonrecursive metadata; serialized tree mode is 40000.', { listingBase64: Buffer.from(`040000 tree ${authenticatedRoot}\tdirectory\0`).toString('base64') }, { accepted: true, mode: '040000', type: 'tree', serializedMode: '40000', oid: authenticatedRoot, pathHex: Buffer.from('directory').toString('hex') });
const validRecord = record(leaf('a'));
const badListings = [
  ['missing-final-NUL', validRecord.subarray(0, -1)], ['empty-record', Buffer.from([0])], ['double-NUL', Buffer.concat([validRecord, Buffer.from([0])])],
  ['missing-tab', Buffer.from(`100644 blob ${blobOid} a\0`)], ['empty-path', Buffer.from(`100644 blob ${blobOid}\t\0`)],
  ['short-OID', Buffer.from(`100644 blob ${blobOid.slice(1)}\ta\0`)], ['nonhex-OID', Buffer.from(`100644 blob ${'g'.repeat(40)}\ta\0`)],
  ['uppercase-OID', Buffer.from(`100644 blob ${blobOid.toUpperCase()}\ta\0`)], ['extra-header-field', Buffer.from(`100644 blob ${blobOid} extra\ta\0`)],
  ['double-header-space', Buffer.from(`100644  blob ${blobOid}\ta\0`)], ['bad-mode', record({ ...leaf('a'), mode: '100600' })],
  ['mode-kind-mismatch', record({ ...leaf('a'), type: 'commit' })], ['gitlink-kind-mismatch', record({ ...leaf('a'), mode: '160000' })],
  ['tree-in-recursive-leaves', Buffer.from(`040000 tree ${authenticatedRoot}\ta\0`)], ['unknown-kind', record({ ...leaf('a'), type: 'tag' })],
  ...['/absolute', '../escape', './dot', 'a/../b', 'a/./b', 'a//b', 'a/'].map(name => [name, record(leaf(name))]),
  ['exact-duplicate', Buffer.concat([validRecord, validRecord])], ['duplicate-different-mode', Buffer.concat([validRecord, record(leaf('a', '100755'))])],
  ['file-then-directory', Buffer.concat([validRecord, record(leaf('a/b'))])], ['directory-then-file', Buffer.concat([record(leaf('a/b')), validRecord])],
  ['trailing-garbage', Buffer.concat([validRecord, Buffer.from('garbage')])], ['NUL-in-path', record(leaf(Buffer.from([97, 0, 98])))],
  ['64-digit-OID-in-SHA1-profile', Buffer.from(`100644 blob ${'a'.repeat(64)}\ta\0`)],
];
for (let index = 0; index < badListings.length; index++) control(`R${String(index + 1).padStart(2, '0')}`, 'raw-listing', badListings[index][0], { profile: 'raw-bytes-recursive-sha1', listingBase64: badListings[index][1].toString('base64') }, { accepted: false, noPartialInventory: true });
const transportBody = Buffer.concat([record(leaf('dir/\n\t café')), record(leaf(' tail '))]);
const splitAt = [1, 17, transportBody.indexOf(0xc3) + 1, transportBody.length - 1];
const chunks = [];
let offset = 0;
for (const end of [...splitAt, transportBody.length]) {
  const body = transportBody.subarray(offset, end);
  chunks.push({ channel: 'stdout', offset, totalBytes: transportBody.length, base64: body.toString('base64'), sha256: sha256(body) }); offset = end;
}
const capture = { bytes: transportBody.length, stdoutSha256: sha256(transportBody), stderrSha256: sha256(Buffer.alloc(0)), fragments: chunks.map((entry, index) => ({ name: `synthetic-stdout-${entry.offset}.json`, bytes: Buffer.from(entry.base64, 'base64').length, sha256: entry.sha256, recordIndex: index })), records: chunks };
control('C01', 'capture', 'Join ordered fragments across header, UTF-8 codepoint and NUL boundaries; bind actual decoded body to receipt.', capture, { accepted: true, stdoutBase64: transportBody.toString('base64'), entries: parseRaw(transportBody) });
const mutations = [
  ['changed-body-unchanged-assertions', value => { value.records[0].base64 = Buffer.from('x').toString('base64'); }],
  ['changed-body-resealed-fragment-only', value => { value.records[0].base64 = Buffer.from('x').toString('base64'); value.records[0].sha256 = sha256(Buffer.from('x')); value.fragments[0].sha256 = value.records[0].sha256; }],
  ['offset-gap', value => { value.records[1].offset++; }], ['offset-overlap', value => { value.records[1].offset--; }],
  ['wrong-total', value => { value.records[0].totalBytes++; }], ['wrong-reference-size', value => { value.fragments[0].bytes++; }],
  ['wrong-record-hash', value => { value.records[0].sha256 = '0'.repeat(64); }], ['wrong-reference-hash', value => { value.fragments[0].sha256 = '0'.repeat(64); }],
  ['wrong-channel', value => { value.records[0].channel = 'stderr'; }], ['duplicate-fragment-name', value => { value.fragments[1].name = value.fragments[0].name; }],
  ['truncated-final-fragment', value => { value.records.pop(); value.fragments.pop(); }], ['reordered-fragments', value => { value.fragments.reverse(); }],
  ['base64-whitespace', value => { value.records[0].base64 += '\n'; }], ['base64-garbage', value => { value.records[0].base64 += '!'; }],
  ['fractional-offset', value => { value.records[0].offset = 0.5; }], ['string-total', value => { value.records[0].totalBytes = String(value.bytes); }],
  ['extra-record', value => { value.records.push(value.records[0]); }], ['wrong-receipt-total', value => { value.bytes++; }],
  ['missing-record', value => { value.records[0] = null; }], ['unbound-body-claim', value => { value.records = []; }],
];
for (let index = 0; index < mutations.length; index++) {
  const input = structuredClone(capture); mutations[index][1](input);
  control(`C${String(index + 2).padStart(2, '0')}`, 'capture', mutations[index][0], input, { accepted: false });
}
const binaryBody = Buffer.from([0, 255, 10, 9, 13, 128]);
const binaryOid = objectId('blob', binaryBody);
const batch = Buffer.concat([Buffer.from(`${binaryOid} blob ${binaryBody.length}\n`), binaryBody, Buffer.from('\n')]);
control('B01', 'batch', 'Exact OID request, byte-sized binary body; pathname never enters newline request framing.', { requests: [binaryOid], responseBase64: batch.toString('base64') }, { accepted: true, objects: [{ oid: binaryOid, kind: 'blob', bodyBase64: binaryBody.toString('base64') }] });
const batchBad = [
  ['truncated-header', Buffer.from(`${binaryOid} blob`)], ['truncated-body', batch.subarray(0, batch.length - 3)], ['missing-body-delimiter', batch.subarray(0, -1)],
  ['negative-size', Buffer.from(`${binaryOid} blob -1\n\n`)], ['fractional-size', Buffer.from(`${binaryOid} blob 6.0\n`)], ['unsafe-size', Buffer.from(`${binaryOid} blob 9007199254740992\n`)],
  ['missing-object', Buffer.from(`${binaryOid} missing\n`)], ['trailing-body', Buffer.concat([batch, Buffer.from('x')])],
  ['wrong-body', Buffer.concat([Buffer.from(`${binaryOid} blob 6\n`), Buffer.alloc(6), Buffer.from('\n')])],
  ['valid-wrong-object', Buffer.concat([Buffer.from(`${blobOid} blob ${blobBody.length}\n`), blobBody, Buffer.from('\n')])],
];
for (let index = 0; index < batchBad.length; index++) control(`B${String(index + 2).padStart(2, '0')}`, 'batch', batchBad[index][0], { requests: [binaryOid], responseBase64: batchBad[index][1].toString('base64') }, { accepted: false });
control('B12', 'batch-request', 'Path with newline/tab/colon maps through authenticated raw inventory to OID, not revision:path plus LF.', { pathsHex: [leaf('line\nbreak').pathHex, leaf('tab\tname').pathHex, leaf(':colon').pathHex], oid: binaryOid }, { accepted: true, everyRequestHex: Buffer.from(binaryOid + '\n').toString('hex'), pathBytesInRequest: false });
control('B13', 'batch-request', 'Two paths sharing a blob retain two path/mode bindings; request de-duplication is optional, not path loss.', { entries: [leaf('a'), leaf('b', '100755')] }, { accepted: true, pathCount: 2, bindingCount: 2 });
const derived = JSON.parse(read('matrix/PROTOCOL-v1.json')).treeControls;
control('D01', 'identity', 'Existing independently frozen derived tree needs no stored lookup.', derived[0], { accepted: true, rootOid: '6a328474bf7bcb7058e2846b7ac14d6eb3893583', storedObjectLookupCalls: 0 });
control('D02', 'identity', 'Same hash asserted stored without object evidence is not authenticated.', derived[1], { accepted: false });
control('D03', 'identity', 'Recompute the authenticated entire candidate root with all 50002 records; never filter the 98 or AGENTS path metadata.', { candidate, listingSha256: sha256(raw), records: 50002 }, { accepted: true, rootOid: authenticatedRoot, quotedIdentities: 98, incorrectRootRejected: 'bd69c1a1dd0e65e442017ab27f86ed72a284fa95' });
control('D04', 'identity', 'Historical 8437 composition is derived, not necessarily a stored Git object. Authenticate override inputs and recompute.', { baseRoot: metadata.baseManifest.baseTree, baseCommit: metadata.baseManifest.base, manifestSha256: sha256(Buffer.from(JSON.stringify(metadata.baseManifest))), overrides: metadata.baseManifest.inputs.filter(entry => entry.revision !== metadata.baseManifest.base).map(entry => ({ path: entry.path, blob: entry.blob, mode: entry.mode, revision: entry.revision, sha256: entry.sha256 })) }, { expectedDerivedRoot: metadata.baseManifest.composedTree, storedObjectLookupCallsForDerivedRoot: 0, candidateExecution: 'NOT_RUN', preparationDidNotQualifyComposition: true });
const metadataRecipes = [
  ['legacy-human-inventory', 'Supply candidateTrackedInventory human display as the only path evidence; must not silently reinterpret as NUL bytes.'],
  ['wrong-inventory-digest', 'Flip one inventory byte with unchanged declared digest; reject before tree or request dispatch.'],
  ['wrong-inventory-count', 'Use valid listing body but wrong declared record count; reject.'],
  ['wrong-source-mode', 'Change selected source mode while keeping path and OID; reject parent binding.'],
  ['wrong-source-OID', 'Change selected OID while leaving candidate tree and manifest SHA unchanged; reject.'],
  ['unknown-source-path', 'Add a requested source not present byte-exactly in authenticated parent; reject.'],
  ['duplicate-selected-path', 'Repeat selected source path even with identical data; reject, not last-wins.'],
  ['duplicate-override-path', 'Repeat an override path, including conflicting modes/OIDs; reject, not Map overwrite.'],
  ['extra-unconsumed-record', 'Append a valid unrelated capture/metadata record; reject for this finite capture profile, not ignore.'],
  ['bodyless-success-stub', 'Return accepted:true and expectedRoot without consuming the supplied body; negative body mutations must still fail.'],
  ['source-only-repair', 'Fix only the primary candidate inventory, leaving sourceEntries ls-tree or base parse or batch path framing unsafe; reject completeness claim.'],
];
for (let index = 0; index < metadataRecipes.length; index++) control(`M${String(index + 1).padStart(2, '0')}`, 'metadata-recipe', metadataRecipes[index][0], { recipe: metadataRecipes[index][1], base: 'authenticated historical METADATA.json and final authorized new capture, as applicable; do not run historical controller' }, { accepted: false, phase: 'DATA/SYNTHETIC only' });
assert.equal(new Set(controls.map(entry => entry.id)).size, controls.length);
const documents = {
  'ACTUAL98.json': { schema: 'independent-path-identities-v1', classification: 'PREPARATION, no candidate execution; no blob or AGENTS contents', candidate, authenticatedRoot, historicalInventorySha256: metadata.candidateTrackedInventorySha256, rawListingSha256: sha256(raw), rawListingBytes: raw.length, totalRecords: actualEntries.length, count: actual98.length, entries: actual98 },
  'CONTROLS.json': { schema: 'independent-path-transport-holdouts-v1', classification: 'Frozen inputs and expected outcomes; every candidate execution NOT_RUN', controlCount: controls.length, countsByFamily: Object.fromEntries([...new Set(controls.map(entry => entry.family))].map(family => [family, controls.filter(entry => entry.family === family).length])), syntheticBlob: { bodyBase64: blobBody.toString('base64'), oid: blobOid }, controls },
  'SOURCE-INVENTORY.json': { schema: 'historical-read-only-source-inventory-v1', authorV2Read: false, sourceCount: sourceFiles.length, dataCount: dataFiles.length, sources: sourceFiles.map(descriptor), data: dataFiles.map(descriptor), scope: 'Historical reachable preparation/controller/capture closure and adjacent frozen DATA gate. No concurrent v2 source, product source, compiler, or AGENTS contents copied.' },
  'PREPARATION.json': { schema: 'independent-preparation-receipt-v1', classification: 'Benign DATA generation plus developmentGitmetadata, NOT verification of repair or candidate', gitCalls, gitChildCount: gitCalls.length, maxChildMs: 10000, serial: true, historicalCaptureBodies: { base: { sha256: baseCapture.sha256, bytes: baseCapture.body.length, fragments: baseCapture.fragments, expectedTree: metadata.baseManifest.baseTree }, batch: { sha256: batchCapture.sha256, bytes: batchCapture.body.length, fragments: batchCapture.fragments, objectCount: batchObjects.length, candidateCommitBodyBound: batchObjects[1] } }, storedRootBodySha256: sha256(storedRootBody), independentlyEncodedRootPayloadSha256: sha256(actualTree.rootPayload), directoryCount: actualTree.directoryCount, actual98: actual98.length, controls: controls.length, preservedHistoricalCounts: { DATA: 25, NOT_RUN: 68 }, historicalForensicSha256: sha256(read('actual-v1/FORENSICS.json')), historicalRoot: forensic.committedTree, authorV2SourceReads: 0, authorV2Executions: 0, productExecutions: 0, compilerExecutions: 0, installs: 0, runtimeImports: 0, nativeOracles: 0, networkRequests: 0, persistentWorkers: 0, instructionPlaintextSnapshots: 0 },
};
process.stdout.write('*** Begin Patch\n');
for (const [name, document] of Object.entries(documents)) {
  assert.equal(fs.existsSync(path.join(own, name)), false, 'never overwrite frozen preparation');
  process.stdout.write(`*** Add File: ${prefix}/path-transport-v2-review/${name}\n`);
  process.stdout.write(JSON.stringify(document, null, 2).split('\n').map(line => '+' + line + '\n').join(''));
}
process.stdout.write('*** End Patch\n');
