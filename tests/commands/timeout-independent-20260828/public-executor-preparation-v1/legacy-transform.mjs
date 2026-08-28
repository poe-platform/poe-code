import assert from 'node:assert/strict';
import { sha } from './common.mjs';

export function legacyAdapter(bytes, expectedHash) {
  assert.equal(sha(bytes), expectedHash, 'ACCEPTED_LEGACY_SOURCE_HASH');
  const original = bytes.toString(), deltas = [];
  const take = (start, end) => { assert.equal(original.split(start).length, 2); assert.equal(original.split(end).length, 2); const first = original.indexOf(start), last = original.indexOf(end, first); assert.ok(last > first); return original.slice(first, last); };
  let source = take("import assert from 'node:assert/strict';", 'async function numeric(group)');
  const collision = take('  async PC02() {', '\n  },\n};');
  source += collision.replace('  async PC02() {', 'async function retirementCollision() {') + '\n}\n\n';
  source += take('async function shellRetirementCollision(sameSentinel)', 'const allIds = ');
  const replace = (before, after, count = 1) => { assert.equal(source.split(before).length - 1, count, 'EXACT_LEGACY_ADAPTER_ANCHOR'); source = source.split(before).join(after); deltas.push({ before, after, count }); };
  replace("from './borrowed-boundary.mjs'", "from '../repaired-f22-v1/recipe/borrowed-boundary.mjs'");
  replace("from 'timeout-under-review'", "from 'virtual-bash/commands/timeout'");
  replace("from 'root-under-review'", "from 'virtual-bash'");
  replace("import { families } from '../../families.mjs';\n", '');
  replace("from '../../clock.mjs'", "from '../clock.mjs'");
  replace("import { materialize, exactRationalDuration } from '../../oracle.mjs';\n", '');
  replace("from '../../review-preparation-v1/recipe/support.mjs'", "from '../review-preparation-v1/recipe/support.mjs'");
  replace("instance.register(timeout.createTimeoutCommand(scheduler ? { scheduler: scheduler.scheduler } : {})); return instance;", "instance.use(root.agentCommands(scheduler ? { timeout: { scheduler: scheduler.scheduler } } : {})); return instance;");
  replace('actual = timeout.createTimeoutCommand({ scheduler: timing.scheduler })', "actual = instance.commands.get('timeout')", 2);
  replace('const clocks = [], shells = [], tracked = [], latches = [];', 'const clocks = [], shells = [], tracked = [], latches = [];\nconst approvedRetirementDisposals = new Map();');
  replace("receipt.activations.push({ id: sameSentinel ? 'PC02' : 'F26'", "approvedRetirementDisposals.set(instance, thrown);\n  receipt.activations.push({ id: sameSentinel ? 'PC02' : 'F26'");
  source += '\nexport { config, receipt, clocks, shells, tracked, latches, approvedRetirementDisposals, tick, latch, watch, clock, waitFor, capture, execute, returned, rejected, blocked, shell, integrity, encodeReason, diagnosticOutcome, preserveDiagnostic, callerCase, retirementCollision };\n';
  assert.ok(!source.includes('await cases[id]()')); assert.ok(!source.includes('exactRationalDuration'));
  return { source, sourceSha256: sha(source), originalSha256: sha(bytes), deltas, included: ['original helper prefix','PC02 body','shellRetirementCollision','callerCase'], excluded: ['all original32 case bodies','numeric loop','original automatic cohort runner'], policy: 'Public aggregate selection only; caller/retirement assertion bodies unchanged.' };
}
