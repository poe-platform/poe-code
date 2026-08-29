import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = path.dirname(fileURLToPath(import.meta.url));
const candidate = path.dirname(destination);
const capture = '/private/tmp/safe-bash-b2-r9-final-binding-v3-20260829';
const started = new Date().toISOString();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename, expected, maximum = 1048576) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  if (expected) assert.equal(stat.size, expected.bytes);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(sha(bytes), expected.sha256);
  return bytes;
}
function write(filename, body) {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      assert.ok(count > 0); offset += count;
    }
  } finally { fs.closeSync(descriptor); }
  assert.equal(sha(read(filename)), sha(bytes));
}
function absent(filename) {
  try { fs.lstatSync(filename); }
  catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw new Error(`slot already used: ${filename}`);
}

try {
  assert.ok(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
  const oldAdmissionPath = '/private/tmp/safe-bash-b2-r9-actual-admission-20260829/ADMISSION.json';
  const oldAdmission = read(oldAdmissionPath);
  const old = JSON.parse(oldAdmission);
  assert.equal(old.checkedAt, '2026-08-29T17:30:12.164Z');
  assert.equal(old.status, 'STOP_UNLAUNCHED_OUTSIDE_AUTHORIZED_WINDOW');
  assert.equal(old.launched, false); assert.equal(old.grantInstalled, false);
  const receiptPath = '/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-independent-review-20260829/r9-delta/RECEIPT.json';
  read(receiptPath, { bytes: 22988, sha256: 'c65013b32f58e6335d1f4a232d97691c8e11dc5dddf08ca7a333ddc72e3db48c' });
  const packetBytes = read(path.join(candidate, 'staged/PACKET.json'), { bytes: 7320, sha256: '5b4a12e14081d6c95f7805358737d32008b0b7f5844413b485e77a81fb1b807d' });
  const packet = JSON.parse(packetBytes);
  for (const row of packet.files) read(path.join(candidate, 'staged', row.path), row);
  assert.equal(packet.files.length, 32);
  const frozen = JSON.parse(read(path.join(candidate, 'staged/metadata/FROZEN-BINDINGS.json')));
  assert.equal(frozen.selectedInputs.length, 309);
  for (const row of frozen.selectedInputs) read(path.join('/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source', row.path), row);
  read(packet.package.path, packet.package);
  const originalBinding = JSON.parse(read(path.join(candidate, 'BINDING.json')));
  for (const row of originalBinding.tools) read(path.join('/private/tmp/safe-bash-coherent-stage-a-20260829-r2/tools', row.path), row);
  const binary = originalBinding.node;
  const stat = fs.lstatSync(binary.path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, binary.bytes);
  const binaryHash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(binary.path, { highWaterMark: 65536 })) binaryHash.update(chunk);
  assert.equal(binaryHash.digest('hex'), binary.sha256);
  const priorBytes = read(path.join(candidate, 'final-binding-v2/GRANT.pending.json'), { bytes: 1081, sha256: '073bb0c9e7fb1678edd150f12e588a938f97d5577c59398b94b2aa633dc04aaf' });
  const prior = JSON.parse(priorBytes);
  assert.equal(prior.reviewCommit, '8c88c15553488aacee8eb469fbd012fd00f8fb27');
  const grant = { ...prior, notBefore: '2026-08-29T17:30:00.000Z', activeDeadline: '2026-08-29T17:57:00.000Z', deadline: '2026-08-29T18:00:00.000Z' };
  const changed = Object.keys(grant).filter(key => JSON.stringify(grant[key]) !== JSON.stringify(prior[key]));
  assert.deepEqual(changed, ['notBefore', 'activeDeadline', 'deadline']);
  assert.ok(Date.parse(grant.issuedAt) <= Date.parse(grant.notBefore));
  assert.equal(Date.parse(grant.deadline) - Date.parse(grant.notBefore), 1800000);
  assert.equal(Date.parse(grant.deadline) - Date.parse(grant.activeDeadline), 180000);
  const support = read(path.join(candidate, 'staged/new/support.mjs'), packet.files.find(row => row.path === 'new/support.mjs')).toString();
  assert.ok(!support.includes('latestStart'));
  assert.ok(support.includes('now < times.activeDeadline'));
  for (const slot of originalBinding.unusedSlots) absent(slot);
  assert.ok(Date.now() < Date.parse('2026-08-29T17:40:00.000Z'));
  const grantBytes = Buffer.from(JSON.stringify(grant, null, 2) + '\n');
  write(path.join(destination, 'GRANT.pending.json'), grantBytes);
  write(path.join(destination, 'HISTORICAL-ADMISSION.json'), oldAdmission);
  const result = {
    status: 'FRESH_BINDING_READY_NOT_INSTALLED_NOT_ACTUAL_GO', started, checkedAt: new Date().toISOString(),
    reviewCommit: grant.reviewCommit, reviewReceipt: { path: receiptPath, bytes: 22988, sha256: 'c65013b32f58e6335d1f4a232d97691c8e11dc5dddf08ca7a333ddc72e3db48c' },
    grant: { path: 'GRANT.pending.json', bytes: grantBytes.length, sha256: sha(grantBytes), mode: '0600', installed: false },
    packet: { bytes: packetBytes.length, sha256: sha(packetBytes) },
    changedFields: changed, command: originalBinding.command,
    window: { notBefore: grant.notBefore, externalLatestStart: '2026-08-29T17:40:00.000Z', activeEnd: grant.activeDeadline, expiry: grant.deadline, fixedSeconds: 1800, publicationReserveSeconds: 180, latestStartMarginSeconds: 600, delayedStartShrinksRemaining: true },
    validator: 'No latestStart field or five-minute latest-start cap; ROOT external cutoff is17:40. Existing now<activeDeadline and fixed-window equations unchanged.',
    authenticated: { packetFiles: 32, sourceInputs: 309, package: packet.package, installerToolFiles: originalBinding.tools.length, node: binary },
    unusedSlots: originalBinding.unusedSlots,
    history: { source: oldAdmissionPath, bytes: oldAdmission.length, sha256: sha(oldAdmission), status: old.status, immutable: true },
    caps: grant.caps, cacheAuthority: grant.mutableCacheAuthority,
    qualification: 'Only time values changed. Original issuance timestamp retained, not backdated. No runtime, npm, compiler, install, Worker, control replay or grant installation.'
  };
  assert.equal(sha(read(oldAdmissionPath)), sha(oldAdmission));
  for (const slot of originalBinding.unusedSlots) absent(slot);
  for (const row of packet.files) read(path.join(candidate, 'staged', row.path), row);
  write(path.join(destination, 'BINDING.json'), JSON.stringify(result, null, 2) + '\n');
  write(path.join(destination, 'HANDOFF.md'), `# r9 fresh time-only binding\n\nPrior late admission17:30:12.164 remains STOP/unlaunched; exact bytes preserved in HISTORICAL-ADMISSION.json.\n\nGrant ${grantBytes.length}B/0600 SHA ${sha(grantBytes)}; not installed. Same real review8c88c155/c65013b3, unchanged packet7320B/5b4a12e. Only notBefore/activeDeadline/deadline changed.\n\nROOT window August29UTC17:30notBefore/17:40external latest/17:57activeEnd/18:00expiry. Ten-minute latest margin expressly authorized; remaining time shrinks,180sec publication reserved. Existing validator has no five-minute latest cap. Original issuance retained; checkedAt is fresh.\n\n32 input postguards,309 source inputs, package, four installer files and streamed Node binary authenticated; three slots absent. Runtime and all672 remain UNRUN in this phase. Caps and qualified128MiB cache policy unchanged. Await ROOT actualGO.\n\nExact command (repository cwd/loginfalse):\n\n${originalBinding.command.text}\n`);
  console.log(JSON.stringify(result));
} catch (reason) {
  console.error(reason);
  process.exitCode = 78;
}
