import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runCoordinator } from '../../../breadth-continuation-20260828/executor-v7-r1/body.mjs';
import { supervise } from '../../../breadth-continuation-20260828/executor-v7-r1/supervisor.mjs';
import { readDocument } from '../../../breadth-continuation-20260828/executor-v7-r1/records.mjs';
import { writeClaim } from '../../../breadth-continuation-20260828/executor-v7-r1/evidence.mjs';
import { home } from './auth.mjs';

export const stubRecipe = 'SYNTHETIC_OWN_FIXTURES_NOT_ROOT_AUTHORITY';
export const passingRows = () => Array.from({ length: 12 }, (_, index) => ({ id: `C${String(index + 1).padStart(2, '0')}`, pass: true, status: 'SYNTHETIC_LITERAL' }));
export async function compose(base, id, options = {}) {
  assert.ok(base.startsWith(`${home}/evidence-01/`));
  const streams = { stdout: [], stderr: [] };
  const phases = [];
  const view = { name: 'owned-literal-stub', root: path.join(home, 'fixtures'), files: [] };
  const operation = { id: 'synthetic-owned-one', ordinal: 1 };
  const drivers = {
    evidenceLimit: options.evidenceLimit ?? 2 * 1024 * 1024,
    checkpoint: async (phase, state) => { phases.push(phase); await options.checkpoint?.(phase, state); },
    configure: async () => ({ workflows: [], schedule: { rows: [] } }),
    authorize: async () => ({ synthetic: true, recipe: stubRecipe, grant: { fixtureOnly: true }, authorization: { fixtureOnly: true, outputRoot: base }, metadataChildren: [], plan: { admission: options.child ? [operation] : [], limits: { admissionSetup: 0 } } }),
    integrity: async () => {},
    stageDeclaration: () => ({ views: [], aliases: [], evidenceFiles: [] }),
    stage: async () => ({ proof: 'OWNED_LITERAL_STUB_NOT_PACKAGE', views: options.child ? { owned: view } : {} }),
    selectOperation: () => operation,
    supervise: async (prepared, synthetic, work, attach) => {
      assert.equal(synthetic, false);
      const config = readDocument(work, prepared.filename, prepared.configSha);
      assert.equal(config.authorization.fixtureOnly, true);
      writeClaim(config, operation, stubRecipe, work);
      options.onChild?.(options.child);
      return supervise(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=128', '--import', path.join(home, 'import-guard.mjs'), path.join(home, 'stub-child.mjs'), options.child], home, { deadline: 10000, onSpawn: attach });
    },
    spawnObserved: (child, receipt) => options.spawnObserved?.(child, receipt),
    defectControls: async () => ({ fixtureOnly: true }),
    controls: async context => { await options.controls?.(context); return { rows: passingRows(), unsafe: false }; },
    cleanup: async context => options.cleanup?.(context),
    inheritedExitCode: () => options.exitCode ?? 0,
    writeStream: (descriptor, bytes) => {
      options.writeStream?.(descriptor, bytes);
      streams[descriptor === 1 ? 'stdout' : 'stderr'].push(Buffer.from(bytes));
    },
  };
  const result = await runCoordinator({ root: base, repository: home, mode: 'admission', runId: id }, drivers);
  const terminalBytes = Buffer.concat(streams.stdout);
  const terminal = terminalBytes.length ? JSON.parse(terminalBytes) : null;
  return { ...result, streams, terminal, phases, runRoot: path.join(base, 'runs', id) };
}
