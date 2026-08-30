import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { combinedIdentities, readIdentity } from './identity.mjs';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function authenticatePacketFiles(packet, reader = readIdentity) {
  const files = combinedIdentities(packet.publisherFiles, packet.preimportFiles);
  for (const entry of files) reader(entry, 131072);
  return files;
}
function main() {
  const [packetFile, packetHash, packetSize, grantHash, grantSize, ledgerHash, ledgerSize] = process.argv.slice(2);
  assert.equal(process.argv.length, 9);
  const packet = JSON.parse(readIdentity({ path: packetFile, sha256: packetHash, bytes: Number(packetSize) }, 131072));
  const grant = JSON.parse(readIdentity({ path: packet.slots.rootGrantFile, sha256: grantHash, bytes: Number(grantSize) }, 32768));
  const ledger = JSON.parse(readIdentity({ path: packet.slots.ledgerPath, sha256: ledgerHash, bytes: Number(ledgerSize) }, 65536));
  assert.equal(grant.action, 'ROOT_B1_PUBLIC15_ACTUAL'); assert.equal(grant.finalPacketSha256, packetHash);
  assert(typeof grant.authorization === 'string' && grant.authorization.trim());
  assert.equal(grant.latestStartUTC, packet.latestStartUTC); assert.equal(grant.expiresUTC, packet.expiresUTC);
  const start = Date.parse(grant.startedUTC), now = Date.now();
  assert(Number.isFinite(start) && start >= Date.parse(packet.issuedUTC) && start <= Date.parse(packet.latestStartUTC));
  assert(Date.parse(packet.expiresUTC) - Date.parse(packet.latestStartUTC) >= 1800000);
  assert(now >= start && now < Math.min(start + 1800000, Date.parse(packet.expiresUTC)));
  assert.equal(ledger.schema, 'B1-measured-known-role-ledger-v3'); assert.equal(ledger.attemptAuthorization, grant.authorization);
  assert(Array.isArray(ledger.starts) && ledger.starts.length >= 6 && ledger.starts.length <= 26);
  const seen = new Set();
  for (const record of ledger.starts) {
    assert(typeof record.id === 'string' && record.id && !seen.has(record.id)); seen.add(record.id);
    assert(typeof record.role === 'string' && Number.isSafeInteger(record.pid) && record.pid > 0 && Number.isFinite(Date.parse(record.startedUTC)));
    assert(record.startObserved === true && record.exitObserved === true && record.closeObserved === true);
  }
  const observedSelf = { id: `publication-preimport-${process.pid}`, role: 'publication-preimport', pid: process.pid, startedUTC: new Date().toISOString(), startObserved: true, observation: 'self process.pid; not independent kernel census', exitObserved: false, closeObserved: false };
  assert(!seen.has(observedSelf.id));
  authenticatePacketFiles(packet);
  readIdentity(packet.publisherBinding, 131072);
  readIdentity(packet.publisherPreseal, 131072);
  readIdentity(packet.runtimePreseal, 32768);
  assert.equal(fs.existsSync(packet.slots.authorityPath), false);
  const authority = { action: grant.action, authorization: grant.authorization, bindingSha256: packet.publisherBinding.sha256, startedUTC: grant.startedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, knownStartsBeforePublication: ledger.starts.length + 1, measuredLedger: { path: packet.slots.ledgerPath, bytes: Number(ledgerSize), sha256: ledgerHash }, observedSelf, metadataHome: grant.metadataHome, finalPacketSha256: packetHash };
  assert(typeof authority.metadataHome === 'string' && authority.metadataHome.startsWith(packet.absentSlots[0] + '/'));
  const body = Buffer.from(JSON.stringify(authority, null, 2) + '\n'); assert(body.length <= 32768);
  const descriptor = fs.openSync(packet.slots.authorityPath, 'wx');
  try { let offset = 0; while (offset < body.length) { const count = fs.writeSync(descriptor, body, offset, body.length - offset); assert(count > 0); offset += count; } } finally { fs.closeSync(descriptor); }
  const argv = [...packet.publicationCommand.argv]; argv[argv.length - 2] = hash(body); argv[argv.length - 1] = String(body.length);
  console.log(JSON.stringify({ executable: packet.publicationCommand.executable, argv, cwd: packet.publicationCommand.cwd, login: false, env: packet.publicationCommand.env, authority: { path: packet.slots.authorityPath, bytes: body.length, sha256: hash(body) }, knownStartsBeforePublication: ledger.starts.length + 1, permission: 'NO AUTOMATIC DISPATCH; coordinator observes helper exit/close; no intervening OS starts. Authenticate this helper and identity dependency BEFORE entry.' }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error); process.exitCode = 78; }
}
