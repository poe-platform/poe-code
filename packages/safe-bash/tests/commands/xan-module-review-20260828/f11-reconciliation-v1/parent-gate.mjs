import assert from 'node:assert/strict';
import { admitFinal } from '../actual-review-v1/a01.mjs';

export async function admitActualJob(options) {
  const final = await admitFinal(options);
  assert.ok(Number.isInteger(final.exitCode), 'closed child must have an integer exit code');
  return { ...final, requiredChildPhase: {
    id: `child:${options.expected.job}`,
    status: final.exitCode === 0 && final.failures === 0 ? 'PASS' : 'FAIL',
    exitCode: final.exitCode,
    receiptFailures: final.failures,
  } };
}

export function aggregateExit({ stopped, phases, perLayout, requiredPhases }) {
  const missing = requiredPhases.some(id => !phases.some(phase => phase.id === id));
  return stopped || missing || phases.some(phase => phase.status !== 'PASS') ||
    Object.values(perLayout).some(result => result.fail || result.blocked || result.missing.length) ? 1 : 0;
}
