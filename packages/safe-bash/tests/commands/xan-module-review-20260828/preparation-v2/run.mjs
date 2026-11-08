import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, verifyCommitted } from './integrity.mjs';

const [action, recipeCommit, ...args] = process.argv.slice(2);
try {
  await verifyCommitted(recipeCommit);
  let result;
  if (action === 'verify-recipe') result = { verified: true, recipeCommit };
  else if (action === 'qualify-synthetic') {
    assert.equal(args.length, 0);
    const { qualify } = await import('./qualify.mjs'); result = await qualify(recipeCommit);
  } else if (action === 'verify-evidence') {
    const { fingerprint, inventory } = await import('../core.mjs');
    const identity = await fingerprint(path.join(ROOT, 'EVIDENCE-SEAL.json'));
    assert.equal(identity.sha256, args[0], 'explicit committed evidence manifest identity');
    const seal = JSON.parse(await readFile(path.join(ROOT, 'EVIDENCE-SEAL.json'), 'utf8'));
    assert.equal(seal.recipeCommit, recipeCommit);
    assert.deepEqual(await inventory(path.join(ROOT, seal.root)), seal.entries, 'append-aware bytes/mode/tree verification');
    result = { verified: true, manifest: identity, appendAware: true };
  } else if (['admit-candidate', 'run-candidate', 'run-selected-build'].includes(action)) {
    const module = await import('./runner.mjs');
    result = action === 'admit-candidate' ? (await module.admit(recipeCommit, args)).result :
      action === 'run-candidate' ? await module.runCandidate(recipeCommit, args) : await module.runSelectedBuild(recipeCommit, args);
  } else throw new Error('Expected verify-recipe | qualify-synthetic | verify-evidence | admit-candidate | run-candidate | run-selected-build');
  process.stdout.write(`${JSON.stringify(result).slice(0, 1024)}\n`);
  process.exitCode = result.exitCode ?? 0;
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message.slice(0, 1024)}\n`); process.exitCode = 2;
}
