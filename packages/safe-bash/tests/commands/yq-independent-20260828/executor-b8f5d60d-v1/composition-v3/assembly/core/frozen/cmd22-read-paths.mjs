import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { atomicJson } from './integrity.mjs';

const bindingHash = '15397c06c09297f1dcd3a386af12bca3f673ff6c5acc68380bb083e5db88aeb9';
const profileHash = '1d49d68bc1136d126aef0695f3c8380f2caebfe5d6a95f50432466694201caef';
const jsonHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function resolveFixtureReadOperand(profile, operand) {
  assert(profile && jsonHash(profile) === profileHash, 'Missing or unbound fixture resolver profile');
  assert.equal(typeof profile.cwd, 'string');
  assert(!profile.cwd.includes('\0') && posix.isAbsolute(profile.cwd), 'Explicit absolute virtual cwd required');
  assert(typeof operand === 'string' && !operand.includes('\0'), 'String/NUL-free operand required');
  return posix.resolve(profile.cwd, operand);
}

export function bindCmd22ReadProjection(job, binding) {
  assert(binding && jsonHash(binding) === bindingHash, 'Missing or unbound CMD-22 path-domain binding');
  assert.equal(job.recordId, 'CMD-22');
  for (const [key, expected] of Object.entries(binding.frozenJob)) assert.deepEqual(job[key], expected, `Changed frozen CMD-22 field: ${key}`);
  assert.deepEqual(job.expected.reads, binding.literalOperands);
  const expectedVfsPaths = binding.literalOperands.map((operand) => resolveFixtureReadOperand(binding.profile, operand));
  assert.deepEqual(expectedVfsPaths, binding.resolvedExpectedReads, 'Bound literal/resolved mapping');
  return { bindingId: binding.id, profileId: binding.profile.id, cwd: binding.profile.cwd, literalOperands: [...binding.literalOperands], expectedVfsPaths };
}

export function assertCmd22ReadPaths(reads, job, evidence, binding) {
  let projection;
  try { projection = bindCmd22ReadProjection(job, binding); }
  catch (cause) {
    atomicJson(join(evidence, 'cmd22-path-domain.json'), { schemaVersion: 1, status: 'INCOMPLETE', recordId: job.recordId, reason: String(cause), semanticFullRecordPass: false });
    throw new Error('INCOMPLETE_CMD22_PATH_BINDING: see cmd22-path-domain.json', { cause });
  }
  const actualVfsPaths = reads.map((event) => event.path);
  atomicJson(join(evidence, 'cmd22-path-domain.json'), { schemaVersion: 1, status: 'BOUND_PROJECTION_ONLY', ...projection, actualVfsPaths, semanticFullRecordPass: false });
  assert.deepEqual(actualVfsPaths, projection.expectedVfsPaths, 'Exact ordered resolved VFS read paths');
}
