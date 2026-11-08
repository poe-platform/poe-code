import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hash } from '../execution-prep-v1/artifacts.mjs';
export async function candidateTypes(stage, consumerRoot, run) {
  const rows = [];
  const fixtures = [['positive-v2', 'execution-v2/consumer-v2.mts.fixture'], ['negative-option', 'negative-option.mts.fixture'], ['negative-api', 'negative-api.mts.fixture'], ['option-inversion', 'negative-option.mts.fixture'], ['api-inversion', 'negative-api.mts.fixture']];
  for (const [id, name] of fixtures) {
    let text = readFileSync(join(stage.harnessRoot, name), 'utf8');
    if (id === 'option-inversion') text = text.replace(', dotglob: true', '');
    if (id === 'api-inversion') text = text.replaceAll('createShoptCommands', 'Shell');
    const target = join(consumerRoot, id + '.mts'); writeFileSync(target, text, { flag: 'wx' });
    const child = await run('type', ['--permission', `--allow-fs-read=${consumerRoot}`, `--allow-fs-read=${stage.moved}`, `--allow-fs-read=${stage.binding.node.path}`, join(stage.moved, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--traceResolution', target], { cwd: consumerRoot, env: { PATH: dirname(stage.binding.node.path), LC_ALL: 'C', TZ: 'UTC' } });
    rows.push({ id, fixtureSha256: hash(Buffer.from(text)), run: child });
  }
  return rows;
}
