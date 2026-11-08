import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeCoordinator } from './outer.mjs';
import { authenticatePacket, readAuthorization } from './authorization.mjs';
import { boundFile } from './projection.mjs';
import { encode } from './records.mjs';
import { requireThat } from '../executor-v4/safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
let result;
try {
  const [phase, runId, authorization, authorizationSha256] = process.argv.slice(2);
  requireThat(phase === 'admission' && /^[a-z0-9-]{1,64}$/.test(runId ?? '') && typeof authorization === 'string', 'LAUNCH_ARGUMENTS', null);
  requireThat(process.execArgv.includes('--unhandled-rejections=strict') && process.execArgv.includes('--max-old-space-size=256'), 'LAUNCH_NODE_POLICY', process.execArgv);
  const recipe = authenticatePacket(root);
  const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
  const node = projection.tools.find(tool => tool.role === 'node');
  boundFile(process.execPath, node);
  const guard = () => { requireThat(authenticatePacket(root) === recipe, 'LAUNCH_RECIPE_DRIFT', null); for (const tool of projection.tools) boundFile(tool.path, tool); readAuthorization(path.resolve(authorization), authorizationSha256, root); };
  result = await observeCoordinator({ node: node.path, args: ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'coordinator.mjs'), phase, runId, path.resolve(authorization), authorizationSha256], cwd: path.resolve(root, '../../../..'), captureRoot: path.join(root, 'runs', `${runId}-supervision`), resultRoot: path.join(root, 'runs', runId), preflight: guard, postflight: guard });
  process.exitCode = result.qualified ? 0 : 1;
  fs.writeSync(1, encode({ schema: 'BREADTH_V7_LAUNCH', qualified: result.qualified, unsafe: result.primaryPresent, reference: result.reference, summaryReference: result.summaryReference, children: result.ledger.map(child => ({ pid: child.pid, group: child.group, reaped: child.reaped, exit: child.exit, close: child.close })), actualRawRetainedOnly: true }, 16384));
} catch (error) {
  process.exitCode = 1;
  try { fs.writeSync(2, encode({ schema: 'LAUNCH_UNSAFE_STOP', code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null, message: typeof error?.message === 'string' ? error.message.slice(0, 2048) : null, knownChildren: result?.ledger.map(child => ({ pid: child.pid, group: child.group, reaped: child.reaped })) ?? [], qualification: false }, 16384)); } catch {}
}
