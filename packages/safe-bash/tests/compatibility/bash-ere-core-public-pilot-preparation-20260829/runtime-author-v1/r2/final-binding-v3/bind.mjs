import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const outerStarted = Number(process.hrtime.bigint() / 1000000n);
const issuedEpoch = Date.now();
const issuedAt = new Date(issuedEpoch).toISOString();
const latestStart = new Date(issuedEpoch + 600000).toISOString();
const expiresAt = new Date(issuedEpoch + 1200000).toISOString();
const directory = path.resolve('tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1/r2/final-binding-v3');
const r2 = path.dirname(directory);
const prior = path.join(r2, 'final-binding-v2');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (filename, cap = 2097152) => {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap, filename);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  return bytes;
};
const write = (name, bytes) => {
  assert(Buffer.byteLength(bytes) <= 2097152);
  fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
};
const profileSha256 = 'bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05';
assert(issuedEpoch + 1200000 <= Date.parse('2026-08-29T18:00:00.000Z'), 'STOP: absolute expiry exceeds ROOT limit');
const profilePath = path.join(r2, 'PROFILE.json');
const profileBytes = read(profilePath, 2097152);
assert.equal(hash(profileBytes), profileSha256);
const profile = JSON.parse(profileBytes);
const reviewBytes = read(path.resolve('tests/compatibility/bash-ere-core-public-pilot-independent-20260829/runtime-review-r2/RESULT.json'));
assert.equal(hash(reviewBytes), 'f5499bbffd18ef06483b26c256bd989d2124abe0fa8afb261d00aa7936becd7b');
const priorGrantBytes = read(path.join(prior, 'PENDING-GRANT.json'), 667);
assert.equal(hash(priorGrantBytes), '1bef3edb200f9a67c7c27260d33ff850e0d1f85fff0f80022cda2636c6ac3adf');
const priorGrant = JSON.parse(priorGrantBytes);
const priorCommand = read(path.join(prior, 'RESOLVED-COMMAND.txt'), 995);
assert.equal(priorCommand.length, 995);
assert.equal(hash(priorCommand), '47a843889d997ee006b3f66c03015eb88bc477cee98ad1accb1d47e36851e721');
const template = JSON.parse(read(path.join(r2, 'GRANT-TEMPLATE.json')));
assert.equal(Object.keys(template).length, 18);
let authenticatedPins = 0;
for (const row of [...profile.assets, profile.node, profile.archive]) {
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
  authenticatedPins++;
}
const core = read(path.join(r2, 'core.mjs')).toString('utf8');
const orderingClause = 'assert(times[0] <= wallNow && wallNow <= times[1] && times[1] < times[2]);';
const spanClause = 'assert(times[2] - times[0] <= 1200000 && wallNow < times[2]);';
assert(core.includes(orderingClause) && core.includes(spanClause));
const coordinator = read(path.join(r2, 'coordinator.mjs')).toString('utf8');
const preRoot = coordinator.slice(0, coordinator.indexOf('fs.mkdirSync(profile.root'));
assert(preRoot.includes('validateGrant(grant, profileHash, started, Date.now())'));
assert(preRoot.includes('for (const row of profile.assets) bind(row)'));
assert(preRoot.includes('for (const row of profile.tools) bind(row)'));
assert(preRoot.includes('bind(profile.archive)'));
assert(preRoot.includes('archiveAdmission(profile.archive'));
const grant = { ...template, authorized: true, pilotReview: priorGrant.pilotReview, issuedAt, latestStart, expiresAt, outerStarted };
assert.deepEqual(Object.keys(grant), Object.keys(priorGrant));
for (const key of Object.keys(priorGrant)) if (!['issuedAt', 'latestStart', 'expiresAt', 'outerStarted'].includes(key)) assert.deepEqual(grant[key], priorGrant[key]);
const grantBytes = Buffer.from(JSON.stringify(grant, null, 2) + '\n');
assert.equal(grantBytes.length, 667);
const grantSha256 = hash(grantBytes);
const commandBytes = Buffer.from(priorCommand.toString('utf8').split(prior).join(directory).replace(hash(priorGrantBytes), grantSha256).replace(String(priorGrant.outerStarted), String(outerStarted)));
assert.equal(commandBytes.length, 995);
assert(commandBytes.toString('utf8').includes(grantSha256));
assert(commandBytes.toString('utf8').includes(String(outerStarted)));
const launch = JSON.parse(read(path.join(prior, 'RESOLVED-LAUNCH.json')));
launch.argv[3] = path.join(directory, 'ROOT-GRANT.json');
launch.argv[4] = grantSha256;
launch.argv[5] = String(outerStarted);
launch.activationGrantPath = launch.argv[3];
launch.stdout = path.join(directory, 'actual-outer.stdout');
launch.stderr = path.join(directory, 'actual-outer.stderr');
launch.commandMeaning = 'UNACTIVATED pending ROOT final GO; exact file bytes, repo cwd, login false; frozen origin never reset';
const unusedSlots = [profile.root, launch.activationGrantPath, launch.stdout, launch.stderr, ...profile.cells.flatMap(cell => [cell.config, cell.stdout, cell.stderr])];
assert.equal(profile.cells.length, 24);
assert.equal(unusedSlots.length, 76);
for (const filename of unusedSlots) assert(!fs.existsSync(filename), filename);
assert(!fs.existsSync(path.join(prior, 'ROOT-GRANT.json')));
write('PENDING-GRANT.json', grantBytes);
write('RESOLVED-COMMAND.txt', commandBytes);
write('RESOLVED-LAUNCH.json', JSON.stringify(launch, null, 2) + '\n');
assert.equal(hash(read(profilePath)), profileSha256);
for (const row of profile.assets) assert.equal(hash(read(row.path)), row.sha256);
for (const filename of unusedSlots) assert(!fs.existsSync(filename), filename);
const sampledMonotonic = Number(process.hrtime.bigint() / 1000000n);
const sampledEpoch = Date.now();
assert(sampledEpoch < issuedEpoch + 600000);
const receipt = {
  status: 'READY_UNACTIVATED_PENDING_ROOT_GO', issuedAt, latestStart, expiresAt, outerStarted,
  profile: { path: profilePath, size: profileBytes.length, sha256: profileSha256, admission: 'regular nonsymlink <=2MiB; exact lstat size equals sameBuffer length; existing sealed SHA256 checked before JSON.parse; SHA pins entire bytes and therefore exact length' },
  sourceCommit: '0f8684d8eea2042cef6ab194ad2f9be165b31698', sourceReview: grant.sourceReview, producerReview: grant.producerReview, pilotReview: grant.pilotReview, pilotReceiptSha256: hash(reviewBytes),
  grant: { path: path.join(directory, 'PENDING-GRANT.json'), bytes: grantBytes.length, sha256: grantSha256, fields: Object.keys(grant).length },
  command: { path: path.join(directory, 'RESOLVED-COMMAND.txt'), bytes: commandBytes.length, sha256: hash(commandBytes) },
  launchSha256: hash(read(path.join(directory, 'RESOLVED-LAUNCH.json'))),
  clock: { source: 'Number(process.hrtime.bigint() / 1000000n)', pairedAdjacentWallAndMonotonicReadsNotAtomic: true, sampledUtc: new Date(sampledEpoch).toISOString(), sampledMonotonic, latestMarginMs: issuedEpoch + 600000 - sampledEpoch, remainingMs: outerStarted + 1200000 - sampledMonotonic, publicationReservedMs: 180000, noResetOnGo: true, absoluteExpiryLimit: '2026-08-29T18:00:00.000Z' },
  validator: { orderingClause, spanClause, fiveMinuteLimit: false, fresh1200AfterDelayedStartRequired: false, evaluated: false },
  sourceAuthGraph: { preparationAuthenticatedPins: authenticatedPins, preparationSkippedFull5378Census: true, essentialOuterPrelaunch: ['fresh wall and frozen hrtime fit', 'exact grant and command bytes', 'profile size/hash and reviewed entry/imported harness assets plus Node executable before evaluating coordinator', '76 unused activation slots', 'direct capture ownership established before Node startup'], coordinatorBeforeRuntimeRootOrProduct: ['profile hash before parse', 'grant validation', 'all asset pins', 'all regular tool pins', 'archive hash/admission before decode'], layoutAndCaseAdmission: 'existing coordinator/cell copyRows, verifyPackage and boundRuntime remain authoritative; no duplicate full prelaunch layout census', qualification: 'ESM harness imports evaluate before coordinator internal asset loop; outer source pins are therefore still essential. No product imports or Worker execution by this DATA helper.' },
  unusedSlots, sourcePostguard: true, activationPathsCreated: false,
  currentCaptureOwnership: { helperPid: process.pid, parentPid: process.ppid, descriptors: [1, 2].map(descriptor => { const stat = fs.fstatSync(descriptor); assert(stat.isFile()); return { descriptor, device: stat.dev, inode: stat.ino, sizeAtSample: stat.size }; }), qualification: 'shell captures established before Node; trusted startup reserved/postchecked, not universal prewrite proof' },
  scope: { dataHelpers: 1, workers: 0, productImports: 0, installs: 0, archiveDecodes: 0, calls: 0, selectedCells: 24 },
  preserved: ['8317555c late-admission zero-call refusal', 'DATA profile-size STOP', 'all prior author/reviewer failures and broader private/full gates'],
  bounds: { conditionalWorkBytes: profile.budget.logicalBytes, headroomBytes: profile.budget.workingBytes - profile.budget.logicalBytes, qualifications: 'same sampled/quiescent dev-npm logical work; not OS quota/atomic peak; startup reservation/postcheck, regular npm pins and Git physical-storage exclusions unchanged' },
};
write('BINDING-RECEIPT.json', JSON.stringify(receipt, null, 2) + '\n');
write('HANDOFF.md', `# Fresh binding only, no activation\n\nIssued ${issuedAt}; latestStart ${latestStart}; expires ${expiresAt}. Frozen hrtime outerStarted=${outerStarted}. Ten-minute start margin, exact twenty-minute span; 180 seconds publication remains reserved. No reset or extension on actual GO. Absolute expiry <=18:00 UTC.\n\nGrant: ${grantBytes.length} bytes, SHA256 ${grantSha256}. Command: ${commandBytes.length} bytes, SHA256 ${hash(commandBytes)}. Use the exact command FILE bytes from repo cwd with login false only after ROOT actual GO and essential bounded checks, not another 5378-file outer census.\n\nThe accepted r2 runtime, profile, 24 selectors/oracles, constructor forwarding and all budget qualifications are unchanged. Profile ${profileBytes.length} bytes was regular/non-symlink, stat-size checked and authenticated with sealed SHA256 before parsing; the prior 1MiB DATA failure remains preserved, not erased. Full auth graph and essential outer ESM source checks are in BINDING-RECEIPT.json.\n\nAt ${receipt.clock.sampledUtc}, latest-start margin ${receipt.clock.latestMarginMs}ms and total remaining ${receipt.clock.remainingMs}ms. These are samples, not a later reset. ${unusedSlots.length} slots remain absent. No activation paths, product evaluation, installs, archive decode, Workers or calls. Prior 8317555c refusal and all broader holds remain unchanged.\n\nCurrent binding grant: one DATA helper; six shell roles, two rg, one apply_patch, one Node and three Git =13 known roles, with one outer-owner allowance =14/14; known peak<=3. Capture16MiB, work64MiB including publication. Administrative reads included a missing optional RESULT.json path, not a product failure. Trusted startup captures are reserved/postchecked; no filesystem/OS quota claimed. Explicit owned-path atomic publication preserves foreign staging.\n`);
console.log(JSON.stringify({ status: receipt.status, issuedAt, latestStart, expiresAt, outerStarted, profile: receipt.profile, grant: receipt.grant, command: receipt.command, clock: receipt.clock, unusedSlots: unusedSlots.length, sourcePostguard: true }, null, 2));
