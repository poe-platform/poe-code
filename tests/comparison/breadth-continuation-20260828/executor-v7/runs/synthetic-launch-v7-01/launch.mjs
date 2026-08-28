import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticatePacket } from '../../authorization.mjs';
import { supervise } from '../../supervisor.mjs';
import { createLedger, launchTracked } from '../../launch-ledger.mjs';
import { createEvidenceBudget } from '../../evidence.mjs';
import { createStore, encode, digest } from '../../records.mjs';
import { boundFile } from '../../projection.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const expected = 'f3abcea2fbe712c6a8c4fbea882e12b81e0e26733ee31fd16bd1a9d83f26b77a';
const guard = () => { if (authenticatePacket(root) !== expected) throw new Error('SYNTHETIC_RECIPE_DRIFT'); };
guard();
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
for (const tool of projection.tools) boundFile(tool.path, tool);
const node = projection.tools.find(tool => tool.role === 'node');
if (process.execPath !== node.path) throw new Error('LAUNCH_NODE');
const evidenceRoot = path.join(directory, 'evidence');
fs.mkdirSync(evidenceRoot);
const budget = createEvidenceBudget(evidenceRoot, { limit: 8388608 });
const store = createStore(evidenceRoot, { budget });
const ledger = createLedger(1);
const wrapper = `const {transport}=await import(${JSON.stringify(pathToFileURL(path.join(root, 'transport.mjs')).href)});let failure;try{await import(${JSON.stringify(pathToFileURL(path.join(root, 'synthetic.mjs')).href)});}catch(error){failure={code:error?.code??null,message:String(error?.message??error),stack:error?.stack??null};process.exitCode=1;}transport().emit({kind:'final',report:{role:'synthetic-runner-not-admission',exitCode:process.exitCode??0,failure}});`;
const args = ['--unhandled-rejections=strict', '--max-old-space-size=256', '--input-type=module', '--eval', wrapper];
store.save('INTENT.json', { date: '2026-08-28', preseal: '0036d968', recipeSha256: expected, tools: projection.tools, args, wrapperSha256: digest(Buffer.from(wrapper)), launchSourceSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), attempts: 1, expectedFamilies: 33, boundedChildren: { runner: 1, outer: 16, nestedStub: 11 }, noEngines: true, noActualAdmission: true });
let receipt;
let failure;
try {
  receipt = await launchTracked({ ledger, kind: 'synthetic-runner', prepare: async () => ({ configSha: expected }), supervise: (_prepared, attach) => supervise(node.path, args, root, { onSpawn: attach, deadline: 180000 }), persist: async (_entry, value) => store.save('RECEIPT.json', value).sha256 });
} catch (error) { failure = { code: error.code ?? null, message: error.message }; }
finally {
  try { await ledger.closeAll(); } catch (error) { failure = { ...(failure ?? {}), cleanup: error.message }; }
  try { guard(); for (const tool of projection.tools) boundFile(tool.path, tool); budget.audit({ partial: Boolean(failure) }); } catch (error) { failure = { ...(failure ?? {}), postguard: error.message }; }
}
const outcome = { recipeSha256: expected, exit: receipt?.exit ?? null, close: receipt?.close ?? null, reaped: receipt?.reaped ?? false, supervisorFailures: receipt?.failures ?? null, captureBytes: receipt?.captureBytes ?? null, failure: failure ?? null, ledger: ledger.entries, noRealEngineExecutionAuthorized: true };
const reference = store.save('OUTCOME.json', outcome); budget.audit();
fs.writeSync(1, encode({ ...outcome, ledger: ledger.entries.map(entry => ({ pid: entry.pid, group: entry.group, reaped: entry.reaped })), reference }, 16384));
process.exitCode = failure || !receipt?.reaped || receipt.exit?.code !== 0 ? 1 : 0;
