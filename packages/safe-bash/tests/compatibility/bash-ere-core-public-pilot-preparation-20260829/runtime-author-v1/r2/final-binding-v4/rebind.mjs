import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const outerStarted = Number(process.hrtime.bigint() / 1000000n);
const issuedEpoch = Date.now();
const issuedAt = new Date(issuedEpoch).toISOString();
const latestStart = new Date(issuedEpoch + 600000).toISOString();
const expiresAt = new Date(issuedEpoch + 1200000).toISOString();
const relative = 'tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1/r2/final-binding-v4';
const directory = path.resolve(relative);
const r2 = path.dirname(directory);
const priorRelative = relative.replace('final-binding-v4', 'final-binding-v2');
const prior = path.resolve(priorRelative);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (filename, cap = 2097152) => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap, filename);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return bytes;
};
const write = (filename, bytes) => {
  assert(Buffer.byteLength(bytes) <= 2097152);
  fs.writeFileSync(path.join(directory, filename), bytes, { flag: 'wx', mode: 0o600 });
};
assert(issuedEpoch + 1200000 <= Date.parse('2026-08-29T18:10:00.000Z'), 'STOP: absolute expiry');
assert(issuedEpoch + 600000 <= Date.parse('2026-08-29T18:00:00.000Z'), 'STOP: absolute latest start');
const profileSha256 = 'bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05';
const profilePath = path.join(r2, 'PROFILE.json');
const profileBytes = read(profilePath);
assert.equal(profileBytes.length, 1286043);
assert.equal(hash(profileBytes), profileSha256);
const profile = JSON.parse(profileBytes);
const reviewBytes = read(path.resolve('tests/compatibility/bash-ere-core-public-pilot-independent-20260829/runtime-review-r2/RESULT.json'));
assert.equal(hash(reviewBytes), 'f5499bbffd18ef06483b26c256bd989d2124abe0fa8afb261d00aa7936becd7b');
const oldGrantBytes = read(path.join(prior, 'PENDING-GRANT.json'), 667);
const oldGrantHash = '1bef3edb200f9a67c7c27260d33ff850e0d1f85fff0f80022cda2636c6ac3adf';
assert.equal(hash(oldGrantBytes), oldGrantHash);
const oldGrant = JSON.parse(oldGrantBytes);
const oldCommandBytes = read(path.join(prior, 'RESOLVED-COMMAND.txt'), 995);
const oldCommandHash = '47a843889d997ee006b3f66c03015eb88bc477cee98ad1accb1d47e36851e721';
assert.equal(hash(oldCommandBytes), oldCommandHash);
const originalOwnerBytes = read(path.join(prior, 'actual-owner.mjs'));
assert.equal(hash(originalOwnerBytes), '5ae7e2cfc1353c03d2b752110634e421c0ca26caf6c1ff7eae0d102c78f94ea2');
const template = JSON.parse(read(path.join(r2, 'GRANT-TEMPLATE.json')));
assert.equal(Object.keys(template).length, 18);
let checkedFiles = 0;
const bind = row => {
  const stat = fs.lstatSync(row.path);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, row.size);
  if (row.mode !== undefined) assert.equal(stat.mode & 0o777, row.mode);
  const descriptor = fs.openSync(row.path, 'r');
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.alloc(65536);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, stat.ino);
    assert.equal(opened.dev, stat.dev);
    let count;
    while ((count = fs.readSync(descriptor, buffer))) digest.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  assert.equal(digest.digest('hex'), row.sha256, row.path);
  checkedFiles++;
};
for (const row of profile.assets) bind(row);
for (const row of profile.tools) bind(row);
bind(profile.archive);
assert.equal(profile.archive.sha256, 'fc559bb3a1bd7db72e959461ce2b733871cde0867095c61fd065021fb498606d');
const layoutRows = [];
for (const layout of profile.layouts) {
  const names = [];
  const walk = parent => {
    for (const name of fs.readdirSync(parent)) {
      const filename = path.join(parent, name);
      const stat = fs.lstatSync(filename);
      assert(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(filename);
      else { assert(stat.isFile()); names.push(path.relative(layout.source, filename)); }
    }
  };
  walk(layout.source);
  assert.deepEqual(names.sort(), layout.shipping.map(row => row.path).sort());
  for (const row of layout.shipping) bind({ ...row, path: path.join(layout.source, row.path) });
  layoutRows.push({ name: layout.name, files: names.length });
}
for (const cell of profile.cells) bind(cell.inheritedCell);
assert.equal(profile.cells.length, 24);
const core = read(path.join(r2, 'core.mjs')).toString('utf8');
assert(core.includes('assert(times[0] <= wallNow && wallNow <= times[1] && times[1] < times[2]);'));
assert(core.includes('assert(times[2] - times[0] <= 1200000 && wallNow < times[2]);'));
const grant = { ...template, authorized: true, pilotReview: oldGrant.pilotReview, issuedAt, latestStart, expiresAt, outerStarted };
assert.deepEqual(Object.keys(grant), Object.keys(oldGrant));
for (const key of Object.keys(oldGrant)) if (!['issuedAt', 'latestStart', 'expiresAt', 'outerStarted'].includes(key)) assert.deepEqual(grant[key], oldGrant[key]);
const grantBytes = Buffer.from(JSON.stringify(grant, null, 2) + '\n');
assert.equal(grantBytes.length, 667);
const grantHash = hash(grantBytes);
const commandSubstitutions = [[prior, directory], [oldGrantHash, grantHash], [String(oldGrant.outerStarted), String(outerStarted)]];
const replace = (text, substitutions) => substitutions.reduce((result, [before, after]) => result.split(before).join(after), text);
const command = replace(oldCommandBytes.toString('utf8'), commandSubstitutions);
assert.equal(Buffer.byteLength(command), 995);
const commandHash = hash(command);
const substitutions = [[priorRelative, relative], [oldGrantHash, grantHash], [oldCommandHash, commandHash], [String(oldGrant.outerStarted), String(outerStarted)]];
const originalOwner = originalOwnerBytes.toString('utf8');
const owner = replace(originalOwner, substitutions);
const inverse = substitutions.map(([before, after]) => [after, before]);
assert.equal(replace(owner, inverse), originalOwner);
assert.notEqual(replace(owner + '\nthrow 0;\n', inverse), originalOwner);
assert.equal(replace(command, commandSubstitutions.map(([before, after]) => [after, before])), oldCommandBytes.toString('utf8'));
const controls = ['owner exact inverse normalization PASS', 'unapproved trailing logic rejected by normalization PASS', 'command exact inverse normalization PASS', '18-field grant non-time policy unchanged PASS'];
const launch = JSON.parse(read(path.join(prior, 'RESOLVED-LAUNCH.json')));
launch.argv[3] = path.join(directory, 'ROOT-GRANT.json');
launch.argv[4] = grantHash;
launch.argv[5] = String(outerStarted);
launch.activationGrantPath = launch.argv[3];
launch.stdout = path.join(directory, 'actual-outer.stdout');
launch.stderr = path.join(directory, 'actual-outer.stderr');
launch.commandMeaning = 'ROOT conditional one actual attempt after checks and prelaunch commit; exact file bytes, no origin reset';
const unusedSlots = [profile.root, launch.activationGrantPath, launch.stdout, launch.stderr, ...profile.cells.flatMap(cell => [cell.config, cell.stdout, cell.stderr])];
assert.equal(unusedSlots.length, 76);
const additionalOwnerSlots = ['actual-owner.stdout', 'actual-owner.stderr', 'ATTEMPT.json', 'ACTUAL-RECEIPT.json'].map(name => path.join(directory, name));
for (const filename of [...unusedSlots, ...additionalOwnerSlots]) assert(!fs.existsSync(filename), filename);
write('PENDING-GRANT.json', grantBytes);
write('RESOLVED-COMMAND.txt', command);
write('RESOLVED-LAUNCH.json', JSON.stringify(launch, null, 2) + '\n');
write('actual-owner.mjs', owner);
assert.equal(hash(read(profilePath)), profileSha256);
for (const row of profile.assets) bind(row);
for (const filename of [...unusedSlots, ...additionalOwnerSlots]) assert(!fs.existsSync(filename), filename);
const sampledMonotonic = Number(process.hrtime.bigint() / 1000000n);
assert(Date.now() <= issuedEpoch + 600000);
const receipt = {
  status: 'CONDITIONAL_ROOT_GO_CHECKS_PASS_COMMIT_REQUIRED_BEFORE_ACTUAL',
  authorization: 'ROOT explicitly authorizes operational owner literal rebind and exactly one conditional actual attempt after checks and binding commit; this is not an independent new owner review',
  issuedAt, latestStart, expiresAt, outerStarted,
  profile: { path: profilePath, bytes: profileBytes.length, sha256: profileSha256, sameBufferHashBeforeParse: true },
  sourceCommit: '0f8684d8eea2042cef6ab194ad2f9be165b31698', sourceReview: grant.sourceReview, producerReview: grant.producerReview, pilotReview: grant.pilotReview, pilotReceiptSha256: hash(reviewBytes),
  grant: { path: path.join(directory, 'PENDING-GRANT.json'), bytes: grantBytes.length, sha256: grantHash, fields: 18 },
  command: { path: path.join(directory, 'RESOLVED-COMMAND.txt'), bytes: Buffer.byteLength(command), sha256: commandHash },
  owner: { path: path.join(directory, 'actual-owner.mjs'), bytes: Buffer.byteLength(owner), sha256: hash(owner), templatePath: path.join(prior, 'actual-owner.mjs'), templateSha256: hash(originalOwnerBytes), normalizedExactlyEqual: true, substitutions: substitutions.map(([before, after]) => ({ before, after, occurrences: originalOwner.split(before).length - 1 })) },
  controls, checkedFileBindings: checkedFiles, layoutRows, toolPins: profile.tools.length, assets: profile.assets.length,
  unusedSlots, additionalOwnerSlots, sourcePostguard: true,
  clock: { source: 'Number(process.hrtime.bigint() / 1000000n)', adjacentWallAndMonoSamplesNotAtomic: true, sampledUtc: new Date().toISOString(), sampledMonotonic, remainingMs: outerStarted + 1200000 - sampledMonotonic, publicationReservedMs: 180000, noResetOnGo: true },
  capture: { helperPid: process.pid, parentPid: process.ppid, descriptors: [1, 2].map(descriptor => { const stat = fs.fstatSync(descriptor); assert(stat.isFile()); return { descriptor, device: stat.dev, inode: stat.ino, sizeAtSample: stat.size }; }), qualification: 'shell capture established before Node; trusted startup reserved/postchecked; unchanged managed prewrite caps' },
  preparation: { helpers: 1, controls: 4, workers: 0, calls: 0, installs: 0, productImports: 0, archiveDecodes: 0, activationPathsCreated: false },
  actualCaps: { knownOS: 40, peak: 4, workers: 24, oneLiveWorker: true, captureBytes: 67108864, workingBytes: 268435456, conditionalLogicalBytes: 254938146, millisecondsFromFrozenBinding: 1200000, publicationMilliseconds: 180000 },
  qualifications: 'sampled/quiescent logical work, not OS quota/native peak/prewrite work guarantee; trusted startup reserved/postchecked; npm regular pins and native closure boundaries unchanged; Git physical storage excluded; UNKNOWN retains ownership/no next case/implicit recovery; all broader gates OPEN',
  historicalPreservation: ['8317555c late admission', 'DATA profile-size STOP', 'f28462050 missing-owner refusal and overstated READY'],
};
write('BINDING-RECEIPT.json', JSON.stringify(receipt, null, 2) + '\n');
write('HANDOFF.md', `# Conditional one actual attempt, literal-only operational rebind\n\nROOT authorizes these exact derived bytes after successful DATA checks and commit, without another GO. This is not an independent new owner review. Original template SHA256 ${hash(originalOwnerBytes)}; rebound ${hash(owner)}. Exact inverse normalization proves no changes outside four declared substitutions. Four controls PASS.\n\nIssued ${issuedAt}; latest ${latestStart}; expires ${expiresAt}; frozen hrtime origin ${outerStarted}. Never reset on launch. 180 seconds publication retained; actual 1200 seconds includes preparation delay.\n\nGrant667B ${grantHash}; command995B ${commandHash}; owner${Buffer.byteLength(owner)}B ${hash(owner)}. Profile1286043B ${profileSha256} unchanged. Source/PURE/producer/pilot reviews remain exact.\n\n${checkedFiles} file bindings authenticated, all76 activation slots plus4 owner evidence slots absent. Compressed archive hashed only; no decode or runtime in preparation. Helper capture opened before startup. Owner logic, evaluator, teardown, coordinator, profile, selectors/oracles and lifecycle observer remain unchanged. Only directory/grant hash/command hash/clock literals differ.\n\nConditional actual GO is consumed by launch/refusal/HARD_STOP, never retried. Capture must precede owner Node startup; execute exact command FILE through the unchanged owner after prelaunch commit. UNKNOWN retains references; no retirement inferred from process close. Ordinary24 only; all broader/private gates OPEN. All three historical failures remain preserved.\n\nPreparation plan: one inspection shell, patch shell+apply_patch, helper shell+Node, commit shell+two Git =8 known roles <=16, peak<=3. Actual separate40-role envelope remains; combined56-role cap. Combined96MiBcapture/512MiBsampledwork; actual64MiBcapture/256MiBsampledwork and conditional254938146B unchanged. Not OS quota/native peak. Startup, npm and Git qualifications unchanged.\n`);
console.log(JSON.stringify({ status: receipt.status, issuedAt, latestStart, expiresAt, outerStarted, grant: receipt.grant, command: receipt.command, owner: receipt.owner, controls, checkedFiles, unusedSlots: unusedSlots.length, clock: receipt.clock }, null, 2));
