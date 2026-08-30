import { readAdmission } from './admission.mjs';
import { describeError, now, requireFact } from './primitives.mjs';

const origin = now();
try {
  requireFact(process.execArgv.length === 0 && !Object.hasOwn(process.env, 'NODE_OPTIONS') && !Object.hasOwn(process.env, 'NODE_PATH'), 'AMBIENT_NODE_BOOTSTRAP');
  const args = process.argv.slice(2);
  requireFact(args.length === 10 && args[0] === '--root-go' && args[2] === '--root-go-sha256' && args[4] === '--recipe' && args[6] === '--recipe-sha256' && args[8] === '--evidence', 'USAGE_OR_MISSING_ROOT_GO');
  const admission = readAdmission({ rootPath: args[1], rootHash: args[3], recipePath: args[5], recipeHash: args[7], evidenceRoot: args[9] });
  const { supervise } = await import('./supervisor.mjs');
  const result = await supervise(admission, origin);
  process.exitCode = result.status === 'PASS_ROLE_PROJECTIONS_ONLY' ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'DENY_OR_FAIL', error: describeError(error), executionGOFromThisProgram: false })}\n`);
  process.exitCode = 1;
}
