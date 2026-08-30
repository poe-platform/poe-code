import fs from 'node:fs';
import path from 'node:path';
import { authority, authenticatePacket, readAuthorization } from './authorization.mjs';
import { viewProjection, stage, authenticateView, inspectTree, boundFile } from './projection.mjs';
import { supervise } from './supervisor.mjs';
import { selectOperation } from '../executor-v4/operations.mjs';
import { controls, defectControls } from '../executor-v4/controls.mjs';
import { qualify } from '../executor-v4/predicates.mjs';
import { requireThat, hash } from '../executor-v4/safety.mjs';

export function productionDrivers(root, repository) {
  const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative)));
  let current;
  let authBinding;
  return {
    checkpoint: async () => {}, spawnObserved: () => {}, cleanup: async () => {}, inheritedExitCode: () => process.exitCode ?? 0,
    configure() {
      const recipe = authenticatePacket(root);
      const projection = read('../executor-v3/PROJECTION.json');
      for (const tool of projection.tools) boundFile(tool.path, tool);
      requireThat(process.execArgv.includes('--unhandled-rejections=strict') && process.execArgv.includes('--max-old-space-size=256'), 'NODE_POLICY', process.execArgv);
      current = { recipe, projection, plan: read('OPERATION-PLAN.json'), workflows: read('../WORKFLOWS.json').rows, legacy: read('../LEGACY-RECIPES.json').rows.map(row => row.recipe), schedule: read('../executor-preparation-v1/SCHEDULE.json') };
      return current;
    },
    authorize(context) {
      const external = readAuthorization(context.authorizationPath, context.authorizationSha256, root);
      authBinding = { path: context.authorizationPath, sha256: context.authorizationSha256 };
      const authorization = { repository, phase: context.phase, runId: context.runId, outputRoot: context.outputRoot, review: external.review, grant: external.grant };
      return { ...authority({ ...authorization, root, projection: current.projection, metadataChildren: context.metadataChildren }), authorization };
    },
    integrity(configuration, staged) {
      if (!configuration) return;
      requireThat(authenticatePacket(root) === configuration.recipe, 'RECIPE_CHANGED', null);
      if (authBinding) readAuthorization(authBinding.path, authBinding.sha256, root);
      for (const tool of configuration.projection.tools) boundFile(tool.path, tool);
      if (staged) for (const view of Object.values(staged.views)) {
        authenticateView(configuration.projection, view); inspectTree(view.root, view.files);
        if (view.oldOrigin) requireThat(!fs.existsSync(view.oldOrigin), 'OLD_LAYOUT_PRESENT', view.oldOrigin);
      }
    },
    stageDeclaration(runRoot, configuration) {
      const views = ['target-installed', 'target-moved', 'baseline-installed'].map(name => ({ root: path.join(runRoot, 'views', name), ...viewProjection(configuration.projection, name) }));
      const aliases = [{ root: path.join(runRoot, 'views/move-origin'), files: views[1].files }];
      const evidenceFiles = ['loaded.mjs', 'loaded.cjs', 'require-consumer.mjs'].map(name => { const bytes = fs.readFileSync(path.join(root, '../executor-v3/fixtures', name)); return { path: path.join(runRoot, 'synthetic-view', name), bytes: bytes.length, mode: 0o644, sha256: hash(bytes) }; });
      return { views, aliases, evidenceFiles };
    },
    stage: (work, configuration) => stage(work, configuration.projection),
    selectOperation: (permission, config, worker) => selectOperation(permission.approved, config, permission.plan, permission.context, worker),
    supervise(prepared, synthetic, work, attach) {
      const node = current.projection.tools.find(tool => tool.role === 'node').path;
      const config = prepared.configValue;
      return supervise(node, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, synthetic ? 'synthetic-worker.mjs' : 'worker.mjs'), path.join(work, prepared.filename), prepared.configSha], work, { onSpawn: attach, legacy: config.kind === 'case' && !config.specimen.id.startsWith('W') });
    },
    controls, defectControls, qualify,
  };
}
