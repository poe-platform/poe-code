import assert from 'node:assert/strict';
import { Owner } from '../agent-bash-coherent-author-20260829/admin-owner-r1/tracked-owner.mjs';
import { admitProducerParameter, bounds, layouts } from './contract.mjs';
export function createSmokeCoordinator(admitted) {
  assert.equal(admitted.authority, 'ROOT_FUTURE_FINAL_SMOKE_EXPLICIT_GO');
  admitProducerParameter(admitted.producer);
  assert.equal(admitted.outputCaptureAlreadyOwned, true);
  assert.equal(admitted.activeEnd - admitted.started, 1020000);
  assert.equal(admitted.deadline - admitted.activeEnd, 180000);
  assert.equal(admitted.commandProfileIndependentlyReviewed, true);
  const owner = new Owner({ raw:admitted.raw, cwd:admitted.cwd, env:admitted.env, tools:admitted.tools,
    wallMs:admitted.deadline-Date.now(), reserveMs:180000, cleanupMs:5000, maxStarts:40, peak:3,
    captureLimit:bounds.captureBytes, metadataLimit:8388608, tailBytes:1048576 });
  return Object.freeze({ owner, async dispatch(commands) {
    assert.deepEqual(commands.map(row => row.role), ['offline-install', ...layouts.map(layout => `smoke-${layout}`)]);
    const results = [];
    for (const command of commands) {
      await admitted.reauthenticate(command);
      const maximum = command.role === 'offline-install' ? 120000 : 270000;
      const result = await owner.run(command.role, command.tool, command.argv, maximum);
      results.push(result);
      if (result.faults.primaryPresent) throw Object.assign(new Error('smoke owner fault'), { result });
      assert.equal(result.row.exitCode, 0, 'settled child failure preserved; no implicit retry');
      await admitted.verifyAndRecord(result);
    }
    return results;
  } });
}
