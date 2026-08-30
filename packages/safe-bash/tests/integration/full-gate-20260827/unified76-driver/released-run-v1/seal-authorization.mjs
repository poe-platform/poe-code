import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../../..');
const packetPath = 'tests/integration/full-gate-20260827/unified76-driver/release-packet-v2-final-routes/PACKET.json';
const packetCommit = 'd9dd698a33421b197ee15432a6606ad91dd06c63';
const metadataReview = '7fd7c7aee3902e8a8a0cc66460858e8ea6966e13';
const driverReview = '97c081ec7c7f180889d3640c29d1cd5fd1b10752';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git', ['--no-replace-objects', ...args], {cwd: root, maxBuffer: 8 * 1024 * 1024});
const read = path => readFileSync(resolve(root, path));
assert.deepEqual(process.argv.slice(2), ['--seal-fresh-root-message']);
const packetBytes = read(packetPath); assert.deepEqual(packetBytes, git('show', `${packetCommit}:${packetPath}`));
const packet = JSON.parse(packetBytes);
assert.equal(sha(JSON.stringify(packet)), '7e40e84c099d8eaa2e9bc4c1cc73274b4a174d699737f34b7015eb4eb706ec70');
const bindings = [];
for (const entry of [...packet.driver.files, ...packet.independent.proofFiles]) {
  const stat = lstatSync(resolve(root, entry.path)); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const bytes = read(entry.path); assert.equal(sha(bytes), entry.sha256); assert.deepEqual(bytes, git('show', `${entry.revision}:${entry.path}`));
  bindings.push(entry);
}
for (const name of ['HANDOFF.md', 'RECEIPT.json', 'verify.mjs']) {
  const path = 'tests/integration/full-gate-20260827/unified76-driver-independent/release-packet-v11/' + name;
  const bytes = read(path); assert.deepEqual(bytes, git('show', `${metadataReview}:${path}`));
  bindings.push({path, revision: metadataReview, bytes: bytes.length, sha256: sha(bytes)});
}
const receipt = {
  action: 'ROOT_RELEASE_UNIFIED76',
  candidate: packet.product.candidate,
  driverSha256: packet.driver.normalizedSha256,
  profileSha256: packet.profile.normalizedSha256,
  packageSha256: packet.product.expectedPackageSha256,
  routesSha256: packet.tools.routesNormalizedSha256,
  public74: true, public75: true, public76: true, independentDriverAccepted: true,
  authorization: "Fresh root user message on August 28, 2026 beginning 'FRESH ROOT AUTHORIZATION — ROOT_RELEASE_UNIFIED76' explicitly authorizes ONE full14-phase fixed76 gate bound by packet d9dd698a33421b197ee15432a6606ad91dd06c63 normalized SHA256 7e40e84c099d8eaa2e9bc4c1cc73274b4a174d699737f34b7015eb4eb706ec70, accepted driver review97c081ec7c7f180889d3640c29d1cd5fd1b10752 and metadata review7fd7c7aee3902e8a8a0cc66460858e8ea6966e13. Candidate/driver/profile/package/routes and literal public74/public75/public76/independentDriverAccepted fields here are exactly those authorized. Execute LAUNCH.md:69 exactly once. Preserve all guards/failures; no retries, wider permissions, mutable overlays or inherited GO. Ordinary assertions aggregate only after safe cleanup/integrity; unknown route/writer/projection/integrity failure stops dependent work without ambient fallback. Preserve exact instruction projection, OS fence, private bb23 read-only regular copies/guards and foreign staging. Bounds600/1800/25805 seconds, cleanup allowance5 seconds, output256MiB/phase4GiB total remain.13 supervised processes plus final sweep. One-shot root policy, not a consumed-token or hard-kernel-drain mechanism.",
  independentEvidence: `${driverReview}:tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/HANDOFF.md; ${metadataReview}:tests/integration/full-gate-20260827/unified76-driver-independent/release-packet-v11/HANDOFF.md`,
  sealedAt: new Date().toISOString(), packetCommit, packetRawSha256: sha(packetBytes), packetNormalizedSha256: sha(JSON.stringify(packet)),
  bindingRecords: bindings,
  attempt: {limit: 1, retryAuthorized: false, consumedTokenMechanism: false, output: packet.launch.output, externalReceipt: packet.launch.authorizationFile},
};
const shipping = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/';
const {requireRelease, verifyDriverSeal} = await import(pathToFileURL(resolve(root, shipping + 'admission.mjs')));
const {readProfile} = await import(pathToFileURL(resolve(root, shipping + 'profile.mjs')));
requireRelease(receipt, verifyDriverSeal(), readProfile());
assert.equal(existsSync(packet.launch.output), false);
assert.equal(existsSync(packet.launch.authorizationFile), false);
const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
writeFileSync(resolve(directory, 'ROOT-AUTHORIZATION.json'), bytes, {flag: 'wx', mode: 0o600});
writeFileSync(packet.launch.authorizationFile, bytes, {flag: 'wx', mode: 0o600});
assert.deepEqual(readFileSync(packet.launch.authorizationFile), bytes);
writeFileSync(resolve(directory, 'AUTHENTICATION.json'), JSON.stringify({at: new Date().toISOString(), receiptSha256: sha(bytes), packetCommit, metadataReview, driverReview, records: bindings.length, requireRelease: 'passed', externalReceipt: packet.launch.authorizationFile, outputStillAbsent: !existsSync(packet.launch.output), fullGateLaunches: 0, qualification: 'Fresh user authorization plus committed byte bindings; not admission/tool/product execution or a cryptographically consumed token.'}, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({receiptSha256: sha(bytes), externalReceipt: packet.launch.authorizationFile, records: bindings.length, requireRelease: 'passed', fullGateLaunches: 0}));
