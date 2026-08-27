import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, read, save, supervised } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), capture = join(own, process.argv[2]), state = read(join(capture, 'state.json'));
const output = join(capture, 'holdouts'); assert(!existsSync(output)); mkdirSync(output);
const scripts = Object.fromEntries(['holdouts.mjs', 'normalization-probe.mjs', 'probe.mjs', 'common.mjs', 'HOLDOUTS.json'].map(name => [name, hash(readFileSync(join(own, name)))]));
for (const [name, digest] of Object.entries(scripts)) assert.equal(digest, state.scriptsBefore[name]);
save(join(output, 'PRE-RUN.json'), { at: new Date().toISOString(), source: state.source, scripts, node: state.toolchain.node, pandoc: state.toolchain.pandoc, installed: inventory(state.installed), isolated: inventory(state.isolated), chronology: 'HOLDOUTS frozen postcommit/preinspection; exact scale/refusal/abort probe implementation after source inspection, before any execution' });
const rows = [], ast = [];
for (const layout of ['isolated', 'moved']) {
  const root = layout === 'isolated' ? state.isolated : state.installed, before = layout === 'isolated' ? state.isolatedBefore : state.installedBefore;
  const harness = join(state.consumer, 'holdouts-' + layout); mkdirSync(harness);
  for (const name of ['probe.mjs', 'normalization-probe.mjs']) cpSync(join(own, name), join(harness, name));
  cpSync(join(state.legacy, 'audit-loader.mjs'), join(harness, 'audit-loader.mjs'));
  const flags = ['--permission', '--allow-fs-read=' + harness, '--allow-fs-read=' + root + '/dist', '--allow-fs-read=' + root + '/package.json', '--import', join(harness, 'audit-loader.mjs')];
  async function run(id, args, executable = process.execPath, input) {
    const inputs = inventory(harness);
    const row = await supervised(join(output, layout), id, executable, args, { input, cwd: state.consumer, env: { PATH: dirname(process.execPath), HOME: state.consumer, TMPDIR: state.work, REVIEW_PACKAGE: root }, inputs, driver: scripts['holdouts.mjs'] });
    for (const load of row.loads) { const path = fileURLToPath(load.url); assert(path.startsWith(root + '/dist/') || path.startsWith(harness + '/')); assert.equal(load.sha256, path.startsWith(root + '/') ? before[path.slice(root.length + 1)] : inputs[path.slice(harness.length + 1)]); }
    row.layout = layout; rows.push(row); return row;
  }
  for (const test of read(join(own, 'HOLDOUTS.json'))) {
    const fixture = join(harness, test.id + '.json'); save(fixture, test);
    const result = await run(test.id, [...flags, join(harness, 'probe.mjs'), fixture]); cpSync(fixture, join(output, layout, test.id + '.input.json'));
    const markdown = result.result?.actual?.stdout ?? '';
    const native = await run(test.id + '-ast', ['--sandbox', '--from=commonmark+strikeout', '--to=json'], state.pandoc, markdown);
    const observed = [], nodes = {}; let failure;
    try {
      assert.equal(result.outcome, 'PASS'); assert.equal(native.outcome, 'PASS');
      const tree = JSON.parse(readFileSync(join(output, layout, test.id + '-ast.stdout')));
      const append = (text, styles) => { for (const character of text) observed.push([character, styles]); };
      function visit(node, styles = []) {
        if (Array.isArray(node)) { for (const child of node) visit(child, styles); return; }
        assert(node && typeof node === 'object'); nodes[node.t] = (nodes[node.t] ?? 0) + 1;
        if (['Para', 'Plain'].includes(node.t)) visit(node.c, styles);
        else if (['Emph', 'Strong', 'Strikeout'].includes(node.t)) visit(node.c, [...styles, node.t]);
        else if (node.t === 'Str') append(node.c, styles);
        else if (['Space', 'SoftBreak'].includes(node.t)) append(' ', styles);
        else if (node.t === 'LineBreak') append('\n', styles);
        else if (node.t === 'Code') append(node.c[1], [...styles, 'Code']);
        else if (['Link', 'Image'].includes(node.t)) visit(node.c[1], [...styles, node.t + ':' + node.c[2][0] + ':' + node.c[2][1]]);
        else throw new Error('unexpected structure ' + node.t);
      }
      visit(tree.blocks);
      assert.deepEqual(observed, test.runs.flatMap(([text, styles]) => [...text].map(character => [character, styles])));
      for (const [type, count] of Object.entries(test.nodes ?? {})) assert.equal(nodes[type] ?? 0, count);
    } catch (error) { failure = error.stack; }
    ast.push({ layout, ...test, markdown, observed, nodes, outcome: failure ? 'FAIL' : 'PASS', error: failure });
    console.log(JSON.stringify({ layout, id: test.id, outcome: failure ? 'FAIL' : 'PASS', markdown }));
  }
  for (const mode of ['scale', 'refusal', 'abort']) await run('normalization-' + mode, [...flags, join(harness, 'normalization-probe.mjs'), mode]);
  assert.deepEqual(inventory(root), before);
}
for (const [name, digest] of Object.entries(scripts)) assert.equal(hash(readFileSync(join(own, name))), digest);
save(join(output, 'RESULTS.json'), { rows, ast, inventoriesUnchangedIncludingNewEntries: true });
