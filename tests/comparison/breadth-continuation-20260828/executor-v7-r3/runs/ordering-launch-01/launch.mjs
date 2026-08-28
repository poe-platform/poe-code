import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { authenticatePacket } from '../../authorization.mjs';
import { boundFile } from '../../projection.mjs';
import { createStore } from '../../records.mjs';
import { createEvidenceBudget } from '../../evidence.mjs';
import { createLedger, launchTracked } from '../../launch-ledger.mjs';
import { supervise } from '../../supervisor.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const recipe = 'bd4690d595751b99b3a2bf020f0063f86c03b23ae2600ecaa637be7dc6096b1c';
const preparationSha = '8c801e9cb97ef940b8df1515c04b55f0b4b601218b13c8e00860d75541c6ce71';
const adapter = path.join(root, 'runs/control-preparation-v2');
function guard() {
  assert.equal(authenticatePacket(root), recipe);
  const seal = JSON.parse(fs.readFileSync(path.join(adapter, 'SEAL.json')));
  for (const entry of seal.files) boundFile(path.join(adapter, entry.path), entry);
  assert.equal(hash(fs.readFileSync(path.join(root, 'runs/ordering-stubs-v2-01/PREPARATION.json'))), preparationSha);
  const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
  for (const entry of projection.tools) boundFile(entry.path, entry);
}
guard();
const evidence = path.join(directory, 'evidence'); fs.mkdirSync(evidence, { mode: 0o755 });
const budget = createEvidenceBudget(evidence, { limit: 8388608 });
const store = createStore(evidence, { budget }), ledger = createLedger(1);
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const args = ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(adapter, 'test.mjs'), preparationSha];
const intent = store.save('INTENT.json', { recipe, preparationSha256: preparationSha, node, args, cwd: evidence, deadline: 300000, oneInvocation: true, realAuthorityEnginesAdmission: false });
let receipt, failure;
try {
  receipt = await launchTracked({ ledger, kind: 'whole-worker-stub-runner', prepare: async () => ({ configSha: intent.sha256 }), supervise: (_prepared, attach) => supervise(node, args, evidence, { deadline: 300000, onSpawn: attach }), persist: async (_entry, value) => store.save('RECEIPT.json', value).sha256 });
} catch (error) { failure = { message: error.message, code: error.code }; }
finally { await ledger.closeAll(); guard(); }
const result = { recipe, preparationSha256: preparationSha, failure: failure ?? null, runner: ledger.entries, exit: receipt?.exit ?? null, close: receipt?.close ?? null, reaped: receipt?.reaped ?? false, failures: receipt?.failures ?? null, captureBytes: receipt?.captureBytes ?? null, report: receipt?.records.at(-1) ?? null, syntheticOnly: true, noRealAuthorityOrEngines: true };
const reference = store.save('OUTCOME.json', result); budget.audit();
process.stdout.write(`${JSON.stringify({ reference, exit: result.exit, close: result.close, reaped: result.reaped, report: result.report })}\n`);
process.exitCode = !failure && receipt?.reaped && receipt.exit?.code === 0 && receipt.close?.code === 0 && receipt.failures.length === 0 ? 0 : 1;
