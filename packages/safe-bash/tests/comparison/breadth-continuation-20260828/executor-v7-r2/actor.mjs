import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runCoordinator } from './body.mjs';
import { supervise } from './supervisor.mjs';
import { transport } from './transport.mjs';
import { authority, loadAuthorityReference, authenticatePacket } from './authorization.mjs';
import { encode, digest, readDocument } from './records.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const [scenario, directory] = process.argv.slice(2);
const allowed = ['positive', 'final-count', 'missing-observer', 'metadata-mismatch', 'child-boolean', 'intentional-status', 'metadata-nonzero', 'array-authority', 'outer-nonzero'];
if (!allowed.includes(scenario) || !directory.startsWith(`${root}/runs/`)) throw new Error('ACTOR_SCOPE');
const writer = transport(), recipe = authenticatePacket(root);
const operations = [{ id: 'stub-probe', ordinal: 1, kind: 'probe', worker: 'engine', layout: 'own-stub' }];
if (scenario === 'intentional-status') operations.push({ id: 'C09-status', ordinal: 2, kind: 'control', worker: 'control' });
const documents = [Buffer.from('{"fixture":"synthetic-review-not-authority"}\n'), Buffer.from('{"fixture":"synthetic-grant-not-authority"}\n')];
const references = documents.map((bytes, index) => ({ commit: '0'.repeat(40), path: `tests/NONEXISTENT-SYNTHETIC-${index}.json`, sha256: digest(bytes) }));
const metadataRaw = [];
const absent = pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
const drivers = {
  checkpoint(phase, state) {
    if (phase !== 'tail') return;
    if (scenario === 'metadata-mismatch') state.output.authorizationMetadata[0].stdoutBytes++;
    if (scenario === 'child-boolean') { state.ledger.entries[0].exit = { code: false, signal: null }; state.ledger.entries[0].close = { code: false, signal: null }; }
  },
  configure: () => ({ schedule: { rows: [] }, workflows: [] }),
  authorize(context) {
    if (scenario === 'array-authority') return authority({ root: '/NONEXISTENT', repository: '/NONEXISTENT', phase: 'admission', runId: 'case', outputRoot: '/NONEXISTENT/runs/case', review: { ...references[0], commit: [references[0].commit] }, grant: references[1], observe() {}, metadataChildren: [] });
    for (let index = 0; index < 2; index++) loadAuthorityReference(references[index], {
      ordinal: index + 1, receipts: context.metadataChildren, syntheticOnly: true,
      read() {
        const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=256', '--import', path.join(root, 'guard.mjs'), path.join(root, 'stub.mjs'), 'metadata', documents[index].toString('base64'), scenario === 'metadata-nonzero' ? 'nonzero' : 'zero'], { cwd: directory, detached: true, env: { PATH: '', LANG: 'C', HOME: directory }, timeout: 10000, maxBuffer: 65536 });
        const result = { pid: child.pid ?? null, status: child.status, signal: child.signal, errorCode: child.error?.code ?? null, stdout: child.stdout ?? Buffer.alloc(0), stderr: child.stderr ?? Buffer.alloc(0), reaped: Boolean(child.pid) && absent(child.pid) && absent(-child.pid) };
        metadataRaw.push({ ...result, stdout: result.stdout.toString('base64'), stderr: result.stderr.toString('base64') });
        fs.writeFileSync(path.join(directory, `metadata-${index}.json`), encode(metadataRaw.at(-1)), { flag: 'wx' });
        return result;
      },
      observe(event) { if (!(scenario === 'missing-observer' && event.receipt.ordinal === 2)) writer.emit(event); },
    });
    return { recipe, synthetic: true, grant: { role: 'synthetic-no-authority' }, authorization: { syntheticOnly: true, recipe, operations, review: references[0], grant: references[1] }, plan: { admission: operations, limits: { admissionSetup: 0 } }, metadataChildren: context.metadataChildren };
  },
  stageDeclaration: () => ({ views: [], evidenceFiles: [] }),
  stage: () => ({ views: { own: { name: 'own-stub', root: directory, files: [] } }, proof: 'OWN_STUB_NOT_PRODUCT_OR_COMPARATOR_STAGING' }),
  integrity() { if (authenticatePacket(root) !== recipe) throw new Error('ACTOR_BINDING'); },
  selectOperation(_permission, config) { return operations.find(row => row.kind === config.kind); },
  supervise(prepared, _synthetic, runRoot, attach) { return supervise(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=256', '--import', path.join(root, 'guard.mjs'), path.join(root, 'stub.mjs'), 'worker', path.join(runRoot, prepared.filename), prepared.configSha], directory, { onSpawn: attach }); },
  spawnObserved() {}, defectControls: () => [],
  async controls({ child }) { if (scenario === 'intentional-status') await child({ mode: 'nonzero', view: { name: 'own-stub' } }); return { unsafe: false, rows: Array.from({ length: 12 }, () => ({ pass: true, syntheticOnly: true, noActualC11: true })) }; },
  cleanup() {}, inheritedExitCode: () => 0,
};
const result = await runCoordinator({ root: path.join(directory, 'body'), repository: root, mode: 'admission', runId: 'case', authorizationPath: 'NO_AUTHORITY' }, drivers);
const actualChildren = result.ledger.map(row => {
  const captured = readDocument(path.join(directory, 'body/runs/case'), `child-${String(row.ordinal).padStart(3, '0')}.receipt.json`, row.receiptSha);
  return { pid: captured.pid, group: -captured.pid, reaped: captured.reaped, exit: captured.exit, close: captured.close };
});
fs.writeFileSync(path.join(directory, 'ACTOR-CLOSURE.json'), encode({ metadataRaw, children: actualChildren, mutatedLedgerDispositions: scenario === 'child-boolean' ? result.ledger.map(row => ({ exit: row.exit, close: row.close })) : [], syntheticOnly: true }), { flag: 'wx' });
writer.emit({ kind: 'final', report: { mode: result.output.mode, runId: result.output.runId, status: result.publication.status, unsafe: result.publication.unsafe, result: result.publication.reference, children: scenario === 'final-count' ? 99 : result.ledger.length, allChildrenReaped: result.ledger.every(row => row.reaped && row.exit && row.close) } });
process.exitCode = scenario === 'outer-nonzero' ? 7 : result.publication.exitCode;
