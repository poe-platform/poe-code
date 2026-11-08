import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { combinedIdentities, readIdentity } from '../stage-b1-r4-final-binding/identity.mjs';
import { admitPrior } from './ledger.mjs';
export function authenticatePacketFiles(packet, reader = readIdentity) {
  const entries = combinedIdentities(packet.publisherFiles, packet.preimportFiles);
  for (const entry of entries) reader(entry, 131072);
  return entries;
}
function main() {
  const [packetFile, packetHash, packetSize, grantHash, grantSize, ledgerHash, ledgerSize] = process.argv.slice(2);
  assert.equal(process.argv.length, 9);
  const packet = JSON.parse(readIdentity({ path: packetFile, sha256: packetHash, bytes: Number(packetSize) }, 131072));
  const grant = JSON.parse(readIdentity({ path: packet.slots.rootGrantFile, sha256: grantHash, bytes: Number(grantSize) }, 32768));
  const prior = JSON.parse(readIdentity({ path: packet.slots.ledgerPath, sha256: ledgerHash, bytes: Number(ledgerSize) }, 65536));
  assert.equal(grant.action, 'ROOT_B1_PUBLIC15_ACTUAL'); assert.equal(grant.finalPacketSha256, packetHash);
  assert(typeof grant.authorization === 'string' && grant.authorization.trim());
  assert.equal(grant.latestStartUTC, packet.latestStartUTC); assert.equal(grant.expiresUTC, packet.expiresUTC);
  const start = Date.parse(grant.startedUTC), now = Date.now();
  assert(Number.isFinite(start) && start >= Date.parse(packet.issuedUTC) && start <= Date.parse(packet.latestStartUTC));
  assert(Date.parse(packet.expiresUTC) - Date.parse(packet.latestStartUTC) >= 1800000);
  assert(now >= start && now < Math.min(start + 1800000, Date.parse(packet.expiresUTC)));
  assert.equal(prior.authorization, grant.authorization);
  assert.equal(prior.owner.entryPath, packet.adminOwner.path); assert.equal(prior.owner.entrySha256, packet.adminOwner.sha256);
  readIdentity(packet.adminOwner, 131072);
  const ownerAdmission = admitPrior(prior, { parentPid: process.ppid, selfPid: process.pid, startedUTC: new Date().toISOString() });
  authenticatePacketFiles(packet); readIdentity(packet.publisherBinding, 131072); readIdentity(packet.publisherPreseal, 131072); readIdentity(packet.runtimePreseal, 32768);
  assert.equal(fs.existsSync(packet.slots.preimportAdmissionPath), false);
  assert(typeof grant.metadataHome === 'string' && grant.metadataHome.startsWith(packet.absentSlots[0] + '/'));
  const admission = { action: grant.action, authorization: grant.authorization, bindingSha256: packet.publisherBinding.sha256, startedUTC: grant.startedUTC, latestStartUTC: grant.latestStartUTC, expiresUTC: grant.expiresUTC, metadataHome: grant.metadataHome, finalPacketSha256: packetHash, ownerAdmission };
  const body = Buffer.from(JSON.stringify(admission, null, 2) + '\n'); assert(body.length <= 32768);
  const descriptor = fs.openSync(packet.slots.preimportAdmissionPath, 'wx');
  try { let offset = 0; while (offset < body.length) { const count = fs.writeSync(descriptor, body, offset, body.length - offset); assert(count > 0); offset += count; } } finally { fs.closeSync(descriptor); }
  console.log(JSON.stringify({ admission: { path: packet.slots.preimportAdmissionPath, bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') }, next: 'OWNER_MUST_OBSERVE_EXIT_CLOSE_THEN_WRITE_FINAL_AUTHORITY_NO_INTERVENING_OS_START' }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (reason) { console.error(reason); process.exitCode = 78; }
}
