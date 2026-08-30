import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readIdentity } from '../stage-b1-r4-final-binding/identity.mjs';
import { ownerLedger, completePreimport } from './ledger.mjs';

export async function publicationSequence(owner, packet, grant, dynamicIdentities) {
  assert.equal(packet.maxKnownOS, 36); assert.equal(packet.adminOwner.path, process.argv[1]);
  readIdentity(packet.adminOwner, 131072);
  assert.equal(grant.action, 'ROOT_B1_PUBLIC15_ACTUAL'); assert.equal(grant.authorization, dynamicIdentities.authorization);
  assert.equal(owner.active.size, 0, 'PRIOR_CHILD_ACTIVE');
  const prior = ownerLedger(owner.snapshot(), grant.authorization, packet.adminOwner);
  const priorIdentity = owner.persist(packet.slots.ledgerPath, prior);
  const result = await owner.run('publication-preimport', packet.preimportCommand.executable, [...packet.preimportCommand.argv, dynamicIdentities.rootGrant.sha256, String(dynamicIdentities.rootGrant.bytes), priorIdentity.sha256, String(priorIdentity.bytes)], 30000);
  assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0);
  const outputStat = fs.lstatSync(result.files[0]); assert(outputStat.isFile() && outputStat.size <= 32768);
  const notice = JSON.parse(fs.readFileSync(result.files[0]));
  assert.equal(notice.admission.path, packet.slots.preimportAdmissionPath);
  const admission = JSON.parse(readIdentity(notice.admission, 32768));
  assert.equal(admission.authorization, grant.authorization); assert.equal(admission.ownerAdmission.owner.pid, process.pid);
  const ownerAdmission = completePreimport(admission.ownerAdmission, result.row);
  const authority = { ...admission, ownerAdmission, knownStartsBeforePublication: ownerAdmission.knownStartsBeforePublication };
  const authorityIdentity = owner.persist(packet.slots.authorityPath, authority);
  const argv = [...packet.publicationCommand.argv]; argv[argv.length - 2] = authorityIdentity.sha256; argv[argv.length - 1] = String(authorityIdentity.bytes);
  const publication = await owner.run('publisher', packet.publicationCommand.executable, argv, 150000);
  return { priorIdentity, authorityIdentity, publication, ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION' };
}
