import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticatePacket } from '../../authorization.mjs';
import { createEvidenceBudget } from '../../evidence.mjs';
import { createStore, encode, digest } from '../../records.mjs';
import { createLedger, launchTracked } from '../../launch-ledger.mjs';
import { supervise } from '../../supervisor.mjs';
import { boundFile } from '../../projection.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const expected = 'b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c';
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
const guard = () => { if (authenticatePacket(root) !== expected) throw new Error('SEALED_INPUT_DRIFT'); for (const tool of projection.tools) boundFile(tool.path, tool); };
guard();
const driver = path.join(directory, 'driver'), output = path.join(directory, 'evidence'); fs.mkdirSync(driver); fs.mkdirSync(output);
const budget = createEvidenceBudget(output, { limit: 8388608 }), store = createStore(output, { budget });
const ledger = createLedger(1);
const wrapper = `const {transport}=await import(${JSON.stringify(pathToFileURL(path.join(root, 'transport.mjs')).href)});let failure;try{await import(${JSON.stringify(pathToFileURL(path.join(root, 'test.mjs')).href)});}catch(error){failure={code:error?.code??null,message:error?.message??null,stack:error?.stack??null};process.exitCode=1;}transport().emit({kind:'final',report:{role:'r2-synthetic-test-driver',exitCode:process.exitCode??0,failure}});`;
const args = ['--unhandled-rejections=strict', '--max-old-space-size=256', '--import', path.join(root, 'guard.mjs'), '--input-type=module', '--eval', wrapper];
store.save('INTENT.json', { date: '2026-08-28', preseal: '5110550d', recipeSha256: expected, args, wrapperSha256: digest(Buffer.from(wrapper)), launcherSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), tools: projection.tools, attempts: 1, expectedFamilies: 15, expectedProcessesIncludingDriver: 36, realAuthorityOrEngines: 0, fullQuotaBoundaries: 'STATIC_ONLY' });
let receipt, failure;
try { receipt = await launchTracked({ ledger, kind: 'synthetic-runner', prepare: async () => ({ configSha: expected }), supervise: (_prepared, attach) => supervise(process.execPath, args, driver, { onSpawn: attach, deadline: 180000 }), persist: async (_entry, value) => store.save('RECEIPT.json', value).sha256 }); }
catch (error) { failure = { code: error.code ?? null, message: error.message }; }
finally {
  try { await ledger.closeAll(); guard(); budget.audit({ partial: Boolean(failure) }); } catch (error) { failure = { ...failure, cleanupOrGuard: error.message }; }
}
const outcome = { recipeSha256: expected, exit: receipt?.exit ?? null, close: receipt?.close ?? null, reaped: receipt?.reaped ?? false, captureBytes: receipt?.captureBytes ?? null, supervisorFailures: receipt?.failures ?? null, failure: failure ?? null, ledger: ledger.entries, realAuthorityOrEngines: 0 };
const reference = store.save('OUTCOME.json', outcome); budget.audit();
fs.writeSync(1, encode({ ...outcome, ledger: ledger.entries.map(row => ({ pid: row.pid, group: row.group, reaped: row.reaped })), reference }, 8192));
process.exitCode = failure || !receipt?.reaped || receipt.exit?.code !== 0 ? 1 : 0;
