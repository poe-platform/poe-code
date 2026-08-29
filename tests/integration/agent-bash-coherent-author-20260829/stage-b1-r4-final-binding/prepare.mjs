import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/kjopek/Workspace/safe-bash';
const base = 'tests/integration/agent-bash-coherent-author-20260829';
const scope = import.meta.dirname;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function admit(filename, expected, maximum = 131072) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= maximum);
  if (expected) assert.equal(stat.size, expected.bytes);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(sha(bytes), expected.sha256);
  return bytes;
}
function save(name, value) { fs.writeFileSync(path.join(scope, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
const oldDirectory = path.join(root, base, 'stage-b1-final-binding-v5');
const oldIdentity = { bytes: 26277, sha256: 'ef0dfcdcafe1da7b274b7f0cfaf9cfea71097796bdf542b93aed9f1e491ff3d7' };
const oldPacket = JSON.parse(admit(path.join(oldDirectory, 'FINAL-BINDING.json'), oldIdentity));
if (process.argv[2] === 'inspect') {
  for (const [name, expected] of [['preimport.mjs', { bytes: 4751, sha256: '39aa97b2ba7b62ad87d109cb96602557d2a8951988101029a74ee00f0efdb2fb' }], ['identity.mjs', { bytes: 3228, sha256: '8e2bd3172834f0cb90e6f3473cbb25ff01a5a389e5c863f614580718f9af2769' }]]) {
    const body = admit(path.join(oldDirectory, name), expected);
    console.log(JSON.stringify({ name, expected })); console.log(body.toString('utf8'));
  }
  const keys = Object.keys(oldPacket); console.log(JSON.stringify({ keys }));
  for (const key of keys) {
    const value = oldPacket[key];
    if (Array.isArray(value) && value.length > 10) console.log(JSON.stringify({ key, count: value.length, first: value[0], last: value.at(-1) }));
    else console.log(JSON.stringify({ key, value }));
  }
  save('INSPECTION.json', { utc: new Date().toISOString(), pid: process.pid, oldIdentity, keys });
} else if (process.argv[2] === 'patch') {
  let patch = '*** Begin Patch\n';
  const files = [];
  for (const entry of oldPacket.preimportFiles) {
    const body = admit(entry.path, entry); const name = path.basename(entry.path);
    assert.ok(['identity.mjs', 'preimport.mjs'].includes(name)); const text = body.toString('utf8'); assert.ok(text.endsWith('\n'));
    patch += `*** Add File: ${base}/stage-b1-r4-final-binding/${name}\n` + text.slice(0, -1).split('\n').map(line => '+' + line).join('\n') + '\n';
    files.push({ path: path.join(scope, name), bytes: body.length, sha256: sha(body), origin: entry });
  }
  fs.writeFileSync(path.join(scope, 'helpers.patch'), patch + '*** End Patch\n', { flag: 'wx' });
  const self = fs.readFileSync(path.join(scope, 'prepare.mjs'));
  save('CONTROL-PRESEAL.json', { schema: 'B1-r4-final-slot-control-preseal-v1', files, sourceHelper: { path: path.join(scope, 'prepare.mjs'), bytes: self.length, sha256: sha(self) }, node: oldPacket.node, groups: ['S01-flat-actual-helper-iteration', 'S02-nested-refusal-before-reader', 'S03-accessor-refusal-before-reader', 'S04-current-activated-paths-window-slots'], productOrPublisherImports: 0, helperMainExecuted: false, controlProcesses: 1 });
  console.log(JSON.stringify({ phase: 'patch', files, utc: new Date().toISOString(), pid: process.pid }));
} else if (process.argv[2] === 'bind') {
  const controlBytes = admit(path.join(scope, 'CONTROL-PRESEAL.json'), { bytes: Number(process.argv[4]), sha256: process.argv[3] });
  const controls = JSON.parse(controlBytes); admit(controls.sourceHelper.path, controls.sourceHelper);
  for (const entry of controls.files) admit(entry.path, entry);
  const { authenticatePacketFiles } = await import('./preimport.mjs');
  const { combinedIdentities } = await import('./identity.mjs');
  const identities = controls.files.map(entry => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }));
  const results = [];
  const check = (id, callback) => { callback(); results.push({ id, status: 'PASS', role: 'PURE_BINDING_NOT_RUNTIME' }); };
  check('S01', () => { const seen = []; authenticatePacketFiles({ publisherFiles: [identities[0]], preimportFiles: [identities[1]] }, entry => { seen.push(entry.path); }); assert.deepEqual(seen, identities.map(entry => entry.path)); });
  check('S02', () => { let reads = 0; assert.throws(() => authenticatePacketFiles({ publisherFiles: [identities[0]], preimportFiles: [identities] }, () => { reads++; })); assert.equal(reads, 0); });
  check('S03', () => { let touched = 0; const invalid = { bytes: 1, sha256: '0'.repeat(64) }; Object.defineProperty(invalid, 'path', { get() { touched++; return identities[0].path; }, enumerable: true }); assert.throws(() => authenticatePacketFiles({ publisherFiles: [invalid], preimportFiles: [] }, () => { touched++; })); assert.equal(touched, 0); });
  const runtimeIdentity = { path: path.join(root, base, 'stage-b1-r4/PRESEAL.json'), bytes: 20804, sha256: 'a7c5e284c4dedbb1726e2231a5e67b44ef960f55203706c73b79ce2e63fa8b70' };
  const publisherIdentity = { path: path.join(root, base, 'stage-b1-r4/PUBLICATION-BINDING.json'), bytes: 3872, sha256: '8cc5f053a7331bd7c31d73064269d2034485a0aa78b4a8c96128af2e3b0559ea' };
  const runtime = JSON.parse(admit(runtimeIdentity.path, runtimeIdentity));
  const publisher = JSON.parse(admit(publisherIdentity.path, publisherIdentity));
  const scalarIdentity = entry => ({ path: path.resolve(root, entry.path), bytes: entry.bytes, sha256: entry.sha256 });
  const runtimeFiles = runtime.files.map(scalarIdentity), publisherFiles = publisher.files.map(scalarIdentity);
  for (const entry of runtimeFiles) admit(entry.path, entry, 4194304);
  for (const entry of publisherFiles) admit(entry.path, entry);
  const packageIdentity = scalarIdentity(publisher.package); admit(packageIdentity.path, packageIdentity, 1048576);
  const node = oldPacket.node; const toolStat = fs.lstatSync(node.path); assert.ok(toolStat.isFile() && !toolStat.isSymbolicLink()); assert.equal(toolStat.size, node.bytes);
  const toolDescriptor = fs.openSync(node.path, 'r'); const toolHash = crypto.createHash('sha256');
  try { const chunk = Buffer.alloc(65536); let offset = 0; while (offset < node.bytes) { const count = fs.readSync(toolDescriptor, chunk, 0, Math.min(chunk.length, node.bytes - offset), offset); assert.ok(count > 0); toolHash.update(chunk.subarray(0, count)); offset += count; } assert.equal(fs.fstatSync(toolDescriptor).size, node.bytes); } finally { fs.closeSync(toolDescriptor); }
  assert.equal(toolHash.digest('hex'), node.sha256);
  const reviewPath = path.join(root, 'tests/integration/agent-bash-coherent-independent-20260829/stage-b1-r4/RECEIPT.json');
  const reviewBody = admit(reviewPath); assert.equal(sha(reviewBody), 'cf206ca25a94fba2c8152b8105aa4eb558996555f4121cfdc48870c34146735d');
  const reviewBlob = crypto.createHash('sha1').update(`blob ${reviewBody.length}\0`).update(reviewBody).digest('hex'); assert.equal(reviewBlob, 'e8552d04ddeeb07c0d2fd64048f71ed1a2bd7333');
  const review = { commit: '53ad11083d9e33fbcd5782672fde0d5dcb24180a', blob: reviewBlob, path: reviewPath, bytes: reviewBody.length, sha256: sha(reviewBody), authority: 'ROOT scoped PREEXEC acceptance; no actual runtime' };
  const publisherPresealPath = path.join(scope, 'PUBLICATION-PRESEAL.json');
  save('PUBLICATION-PRESEAL.json', { schema: 'B1-r4-current-publication-binding-preseal-v1', binding: publisherIdentity, files: publisherFiles, qualifiedLogic: '7c8fb0e3 inherited logical profile plus current r4 PREEXEC53ad', actualAuthority: false });
  const publisherPresealBody = admit(publisherPresealPath); const publisherPreseal = { path: publisherPresealPath, bytes: publisherPresealBody.length, sha256: sha(publisherPresealBody) };
  const work = publisher.outputs.work;
  const slots = { authorityPath: path.join(work, 'PUBLICATION-AUTHORITY-r4.json'), ledgerPath: path.join(work, 'PREPUBLICATION-LEDGER-r4.json'), preimportCapture: ['stdout','stderr'].map(extension => path.join(work, `publication-preimport-r4.${extension}`)), rootGrantFile: path.join(scope, 'ACTUAL-ROOT-GRANT.json'), knownStartsBeforePublication: { status: 'UNMEASURED; no runtime', type: 'integer7..27', rule: '6..26 actual observed retired prior starts plus executing preimport PID; no planned count substitution; observe helper exit/close then no intervening OS start before publisher' } };
  const absentSlots = [work, publisher.outputs.evidence, publisher.outputs.publication, ...publisher.outputs.launchCaptures, ...publisher.outputs.startupCaptures, slots.authorityPath, slots.ledgerPath, ...slots.preimportCapture, slots.rootGrantFile];
  for (const filename of absentSlots) assert.equal(fs.existsSync(filename), false);
  const issued = Date.now();
  const packetPath = path.join(scope, 'FINAL-BINDING.json');
  const packet = {
    schema: 'B1-final-binding-v5', version: 'CURRENT_B1_R4_BINDINGS',
    issuedUTC: new Date(issued).toISOString(), latestStartUTC: new Date(issued + 1200000).toISOString(), expiresUTC: new Date(issued + 3000000).toISOString(),
    windowEnforcement: 'Externally enforced activation window; frozen runtime unchanged. Earlier inclusive 1800s deadline wins. No authority until different final-slot acceptance and fresh ROOT actual GO.',
    reviews: { currentR4: review, inheritedQualifiedLogic: oldPacket.reviews },
    runtimeSourceCommit: '14be114b99bd4df2e275ee5d1f59db45bb2085d9', publisherSourceCommit: '14be114b99bd4df2e275ee5d1f59db45bb2085d9',
    runtimePreseal: runtimeIdentity, publisherBinding: publisherIdentity, publisherPreseal,
    runtimeFiles, publisherFiles, preimportFiles: identities, node,
    product: { sourceTree: runtime.sourceTree, inputs: 309, emits: 1012, members: 1014, package: packageIdentity, PUBLIC: '96 fixture entries /98 provenance, unchanged r4 accepted closure' },
    absentSlots,
    runtimeCommand: { executable: '/bin/zsh', argv: [path.join(root, base, 'stage-b1-r4/launch.sh'), runtimeIdentity.path, runtimeIdentity.sha256, String(runtimeIdentity.bytes)], cwd: root, login: false, env: { B1_ROOT_GO: 'ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION' } },
    publicationCommand: { executable: '/bin/zsh', argv: [path.join(root, base, 'stage-b1-r4/publication.sh'), '--publish', publisherIdentity.path, publisherIdentity.sha256, String(publisherIdentity.bytes), slots.authorityPath, { slot: 'authoritySha256', type: 'sha256', producedBy: 'preimport from SAME exclusively written authority Buffer' }, { slot: 'authorityBytes', type: 'positive integer decimal', producedBy: 'same authority Buffer' }], cwd: root, login: false, env: { PATH: '/usr/bin:/bin' } },
    slots, bounds: publisher.workerProfile, actualAuthority: false,
    qualifications: oldPacket.qualifications,
    preimportCommand: { executable: node.path, argv: [path.join(scope, 'preimport.mjs'), packetPath, { slot: 'finalPacketSha256', source: 'BINDING-RECEIPT.json.sha256' }, { slot: 'finalPacketBytes', source: 'BINDING-RECEIPT.json.bytes' }, { slot: 'rootGrantSha256', source: slots.rootGrantFile }, { slot: 'rootGrantBytes', source: slots.rootGrantFile }, { slot: 'observedLedgerSha256', source: slots.ledgerPath }, { slot: 'observedLedgerBytes', source: slots.ledgerPath }], cwd: root, login: false, capture: slots.preimportCapture, rule: 'Authenticate this packet, BOTH exact helpers and Node before Node entry; fd1/fd2 outer capture opens first. No automatic publisher dispatch.' },
    controlSourcePreseal: { path: path.join(scope, 'CONTROL-PRESEAL.json'), bytes: controlBytes.length, sha256: sha(controlBytes) },
    historicalData: { oldFinalPacket: oldIdentity, source309Emits1012Tools2274Links12: 'Inherited authenticated DATA, no new full census', currentChecks: 'All consumed runtime/publisher/helper files, package bytes and Node streamhash; no inflation or product import', oldAttempt: '8PASS2FAIL5UNRUN/publication78/32roles unchanged, CONSUMED' },
    activatedConsumers: [ { path: path.join(scope, 'prepare.mjs'), route: 'current scalar identities -> same copied authenticatePacketFiles' }, { path: path.join(scope, 'preimport.mjs'), route: 'main -> authenticatePacketFiles -> combinedIdentities -> readIdentity' }, { path: path.join(scope, 'identity.mjs'), route: 'exact own-data flat identity gate' }, { path: path.join(root, base, 'stage-b1-r4/bootstrap.mjs'), route: 'current r4 PRESEAL -> current r4 run, retained r3 layout helper' }, { path: path.join(root, base, 'stage-b1-r4/publish.mjs'), route: 'current r4 publication binding -> current outputs; unchanged policy' } ],
    retainedNonactivatedChecks: 'Old r2/r3 source-chain pins in runtime files and v2 controls/seal publisher entries remain hash checks only, not activated routes.',
    identityPolicy: oldPacket.identityPolicy,
    retiredWindows: [ { issuedUTC: oldPacket.issuedUTC, latestStartUTC: oldPacket.latestStartUTC, expiresUTC: oldPacket.expiresUTC, status: 'CONSUMED_ONE_ATTEMPT; do not relabel unused' }, oldPacket.retiredV4, { status: 'All earlier unused/prospective r4 windows RETIRED_UNUSED; r4 had no activation window before this metadata' } ],
    preimportOrigin: { status: 'BYTEEXACT v5 preimport + identity, new current physical locators', origins: controls.files },
  };
  authenticatePacketFiles(packet);
  check('S04', () => {
    assert.equal(Date.parse(packet.expiresUTC) - Date.parse(packet.latestStartUTC), 1800000);
    assert.equal(Date.parse(packet.latestStartUTC) - Date.parse(packet.issuedUTC), 1200000);
    assert.equal(packet.actualAuthority, false); assert.equal(packet.bounds.knownOS, 32); assert.equal(packet.bounds.calls, 15);
    assert.ok(packet.runtimeCommand.argv[0].includes('/stage-b1-r4/')); assert.ok(packet.publicationCommand.argv[0].includes('/stage-b1-r4/')); assert.ok(packet.preimportCommand.argv[0].includes('/stage-b1-r4-final-binding/'));
    assert.equal(packet.preimportFiles.length, 2); assert.equal(combinedIdentities(packet.publisherFiles, packet.preimportFiles).length, 7);
    assert.equal(typeof packet.slots.knownStartsBeforePublication, 'object'); assert.equal(fs.existsSync(slots.rootGrantFile), false); assert.equal(fs.existsSync(slots.ledgerPath), false);
  });
  save('CONTROLS.json', { rows: results, productCalls: 0, publisherMainExecuted: false, preimportMainExecuted: false, utc: new Date().toISOString(), pid: process.pid });
  save('FINAL-BINDING.json', packet);
  const packetBytes = admit(packetPath);
  const receipt = { path: packetPath, bytes: packetBytes.length, sha256: sha(packetBytes), issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, review, actualAuthority: false };
  save('BINDING-RECEIPT.json', receipt);
  save('COMMANDS.json', { runtime: packet.runtimeCommand, preimport: { ...packet.preimportCommand, argv: packet.preimportCommand.argv.map(value => value?.slot === 'finalPacketSha256' ? receipt.sha256 : value?.slot === 'finalPacketBytes' ? String(receipt.bytes) : value) }, publication: packet.publicationCommand, qualification: 'Dynamic ROOT grant/observed-ledger/authority identities intentionally unpopulated; review only.' });
  console.log(JSON.stringify({ receipt, publisherPreseal, runtimeFiles: runtimeFiles.length, publisherFiles: publisherFiles.length, helpers: identities, controls: results.length, utc: new Date().toISOString(), pid: process.pid }));
} else throw new Error('unknown binding preparation phase');
