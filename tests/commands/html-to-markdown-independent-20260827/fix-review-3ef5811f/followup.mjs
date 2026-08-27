import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, read, save, supervised } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), capture = join(own, process.argv[2] ?? 'run05'), state = read(join(capture, 'state.json'));
const output = join(capture, 'followup'); assert(!existsSync(output)); mkdirSync(output);
const scripts = Object.fromEntries(['followup.mjs', 'adjacent-probe.mjs', 'common.mjs', 'NEIGHBORS.json'].map(name => [name, hash(readFileSync(join(own, name)))]));
save(join(output, 'PRE-RUN.json'), { at: new Date().toISOString(), source: state.source, scripts, node: state.toolchain.node, pandoc: state.toolchain.pandoc, installed: inventory(state.installed), isolated: inventory(state.isolated), chronology: 'Post-main-isolated-replay/source-inspection; targeted hypotheses and exact semantic expectations frozen here before executing these inputs' });
const rows = [], ast = [];
for (const layout of ['isolated', 'moved']) {
  const root = layout === 'isolated' ? state.isolated : state.installed, before = layout === 'isolated' ? state.isolatedBefore : state.installedBefore;
  const harness = join(state.consumer, 'followup-' + layout); mkdirSync(harness);
  cpSync(join(own, 'adjacent-probe.mjs'), join(harness, 'adjacent-probe.mjs')); cpSync(join(state.legacy, 'audit-loader.mjs'), join(harness, 'audit-loader.mjs'));
  const flags = ['--permission', '--allow-fs-read=' + harness, '--allow-fs-read=' + root + '/dist', '--allow-fs-read=' + root + '/package.json', '--import', join(harness, 'audit-loader.mjs')];
  async function run(id, args, executable = process.execPath, input) {
    const inputs = inventory(harness);
    const row = await supervised(join(output, layout), id, executable, args, { input, cwd: state.consumer, env: { PATH: dirname(process.execPath), HOME: state.consumer, TMPDIR: state.work, REVIEW_PACKAGE: root }, inputs, driver: scripts['followup.mjs'] });
    for (const load of row.loads) { const path = fileURLToPath(load.url); assert(path.startsWith(root + '/dist/') || path.startsWith(harness + '/')); assert.equal(load.sha256, path.startsWith(root + '/') ? before[path.slice(root.length + 1)] : inputs[path.slice(harness.length + 1)]); }
    row.layout = layout; rows.push(row); return row;
  }
  for (const test of [...read(join(own, 'NEIGHBORS.json')), { id: 'edge-controls', action: 'edges' }, ...['trim', 'normalize', 'destination', 'entities'].map(operation => ({ id: 'scan-abort-' + operation, action: 'scan-abort', operation }))]) {
    const fixture = join(harness, test.id + '.json'); save(fixture, test);
    const result = await run(test.id, [...flags, join(harness, 'adjacent-probe.mjs'), fixture]); cpSync(fixture, join(output, layout, test.id + '.input.json'));
    if (!test.runs) continue;
    const markdown = result.result?.actual?.stdout ?? '';
    const native = await run(test.id + '-ast', ['--sandbox', '--from=commonmark+strikeout', '--to=json'], state.pandoc, markdown);
    const tree = JSON.parse(readFileSync(join(output, layout, test.id + '-ast.stdout')));
    const observed = [], structures = []; let failure;
    function visit(node, styles = []) {
      if (Array.isArray(node)) { for (const child of node) visit(child, styles); return; }
      if (!node || typeof node !== 'object') return;
      structures.push(node.t);
      if (['Emph', 'Strong', 'Strikeout'].includes(node.t)) visit(node.c, [...styles, node.t]);
      else if (node.t === 'Str') for (const character of node.c) observed.push([character, styles]);
      else if (['Space', 'SoftBreak'].includes(node.t)) observed.push([' ', styles]);
      else if (node.t === 'LineBreak') observed.push(['\n', styles]);
      else visit(node.c, styles);
    }
    visit(tree.blocks);
    try { assert.equal(result.outcome, 'PASS'); assert.equal(native.outcome, 'PASS'); assert(!structures.some(type => ['OrderedList', 'BulletList', 'RawInline', 'RawBlock'].includes(type))); assert.deepEqual(observed, test.runs.flatMap(([text, styles]) => [...text].map(character => [character, styles]))); } catch (error) { failure = error.stack; }
    ast.push({ layout, ...test, markdown, structures, observed, outcome: failure ? 'FAIL' : 'PASS', error: failure });
    console.log(JSON.stringify({ layout, id: test.id, outcome: failure ? 'FAIL' : 'PASS', markdown }));
  }
  assert.deepEqual(inventory(root), before);
}
for (const [name, digest] of Object.entries(scripts)) assert.equal(hash(readFileSync(join(own, name))), digest);
save(join(output, 'RESULTS.json'), { rows, ast, inventoriesUnchangedIncludingNewEntries: true });
