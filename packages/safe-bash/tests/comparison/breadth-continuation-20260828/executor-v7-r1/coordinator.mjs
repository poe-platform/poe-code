import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
let primaryPresent = false;
let primary;
try {
  const [{ runCoordinator }, { productionDrivers }, { transport }] = await Promise.all([import('./body.mjs'), import('./production.mjs'), import('./transport.mjs')]);
  const result = await runCoordinator({ root, repository: path.resolve(root, '../../../..'), mode: process.argv[2], runId: process.argv[3], authorizationPath: process.argv[4], authorizationSha256: process.argv[5] }, productionDrivers(root, path.resolve(root, '../../../..')));
  process.exitCode = result.publication.exitCode;
  transport().emit({ kind: 'final', report: { mode: result.output.mode, runId: result.output.runId, status: result.publication.status, unsafe: result.publication.unsafe, result: result.publication.reference, children: result.ledger.length, allChildrenReaped: result.ledger.every(entry => !entry.launchAttempted || (entry.reaped && entry.exit && entry.close)) } });
} catch (error) { primaryPresent = true; primary = error; process.exitCode = 1; }
if (primaryPresent) {
  let code = null, message = null;
  try { const own = Object.getOwnPropertyDescriptors(primary ?? {}); if (typeof own.code?.value === 'string') code = own.code.value.slice(0, 80); if (typeof own.message?.value === 'string') message = own.message.value.slice(0, 1024); } catch {}
  const value = { schema: 'COORDINATOR_BOOTSTRAP_OR_FINAL_FAILURE', status: 'UNSAFE_STOP', primaryPresent, primaryUndefined: primary === undefined, primaryType: primary === null ? 'null' : typeof primary, code, message, rawLargeReasonRetained: false };
  try { fs.writeSync(2, `${JSON.stringify(value)}\n`); } catch {}
}
