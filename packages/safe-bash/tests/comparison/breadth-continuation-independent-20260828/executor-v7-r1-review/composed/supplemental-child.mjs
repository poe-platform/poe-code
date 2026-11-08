import fs from 'node:fs';
import path from 'node:path';
import { home } from './auth.mjs';
import { runCoordinator } from '../../../breadth-continuation-20260828/executor-v7-r1/body.mjs';
import { transport } from '../../../breadth-continuation-20260828/executor-v7-r1/transport.mjs';

if (process.argv[2] !== 'terminal-missing-failures') throw new Error('UNSEALED_SUPPLEMENTAL_MODE');
const root = path.join(home, 'evidence-02/body');
const drivers = {
  evidenceLimit: 1048576,
  checkpoint: async () => {}, configure: () => ({ workflows: [] }),
  authorize: () => ({ synthetic: true, recipe: 'SYNTHETIC_UNUSABLE_FOR_ROOT', grant: { fixtureOnly: true }, authorization: { fixtureOnly: true }, metadataChildren: [], plan: { admission: [], limits: { admissionSetup: 0 } } }),
  integrity: async () => {}, stageDeclaration: () => ({ views: [] }),
  stage: () => ({ views: {}, proof: 'LITERAL_NO_PACKAGES' }),
  selectOperation: () => { throw new Error('NO_CHILD_ALLOWED'); },
  supervise: () => { throw new Error('NO_CHILD_ALLOWED'); },
  spawnObserved: () => { throw new Error('NO_CHILD_ALLOWED'); },
  defectControls: () => ({ fixtureOnly: true }),
  controls: () => ({ unsafe: false, rows: Array.from({ length: 12 }, () => ({ pass: true, fixtureOnly: true })) }),
  cleanup: async () => {}, inheritedExitCode: () => 0,
  writeStream: (descriptor, bytes) => {
    if (descriptor !== 1) return fs.writeSync(descriptor, bytes);
    fs.writeFileSync(path.join(home, 'evidence-02/ORIGINAL-TERMINAL.json'), bytes, { flag: 'wx' });
    const malformed = JSON.parse(bytes);
    delete malformed.failures;
    fs.writeSync(1, `${JSON.stringify(malformed)}\n`);
  },
};
const result = await runCoordinator({ root, repository: home, mode: 'admission', runId: 'synthetic' }, drivers);
transport().emit({ kind: 'final', report: { fixtureOnly: true, status: result.publication.status, children: result.ledger.length, allPass: result.output.controls.rows.every(row => row.pass) } });
process.exitCode = result.publication.exitCode;
