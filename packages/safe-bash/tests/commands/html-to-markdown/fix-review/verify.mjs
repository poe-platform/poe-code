import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url)), root = resolve(own, '../../../..');
const output = realpathSync(mkdtempSync(join(tmpdir(), 'html-repair-review-'))), build = join(output, 'build');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = directory => Object.fromEntries(readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return Object.entries(inventory(path)).map(([name, digest]) => [entry.name + '/' + name, digest]);
  assert.equal(entry.isFile(), true); return [[entry.name, hash(readFileSync(path))]];
}));
const before = inventory(join(root, 'src/commands/html-to-markdown'));
const report = { scope: 'author repair: compiled module closure, NOT public/full package acceptance', candidate: process.env.HTML_REPAIR_SOURCE_COMMIT ?? 'unfrozen author development', output, sourceBefore: before, runtime: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, phases: [], rows: [] };
function run(id, binary, args, options = {}) {
  const { expectedStatus = 0, ...spawnOptions } = options;
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, ...spawnOptions });
  writeFileSync(join(output, id + '.stdout'), result.stdout ?? ''); writeFileSync(join(output, id + '.stderr'), result.stderr ?? '');
  report.phases.push({ id, status: result.status, signal: result.signal, error: result.error?.message });
  assert.equal(result.signal, null, id + ' must settle naturally'); assert.equal(result.status, expectedStatus, id + '\n' + result.stdout + result.stderr);
  return result.stdout;
}
function product(job) {
  const row = JSON.parse(run(job.id, process.execPath, [join(own, 'worker.mjs'), build, JSON.stringify(job)]));
  assert.equal(row.loadedEntrySHA256, report.emittedBefore['commands/html-to-markdown/index.js']);
  report.rows.push(row); return row;
}
try {
  writeFileSync(join(output, 'package.json'), '{"type":"module","private":true}\n');
  const compiler = join(root, 'node_modules/typescript/bin/tsc');
  const listed = run('compile-inputs', process.execPath, [compiler, '-p', join(own, '../tsconfig.build.json'), '--listFilesOnly'], { timeout: 30000 });
  const inputs = listed.split('\n').filter(path => path.startsWith(root + '/src/'));
  const sourceInputs = () => Object.fromEntries(inputs.map(path => [path.slice(root.length + 1), hash(readFileSync(path))]));
  report.sourceInputsBefore = sourceInputs();
  run('build', process.execPath, [compiler, '-p', join(own, '../tsconfig.build.json'), '--outDir', build], { timeout: 30000 });
  report.emittedBefore = inventory(build);
  const consumer = join(output, 'consumer.mts');
  writeFileSync(consumer, readFileSync(join(own, '../compiled-consumer.mts.fixture')));
  const flags = [compiler, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--typeRoots', join(root, 'node_modules/@types')];
  run('strict-consumer', process.execPath, [...flags, consumer], { timeout: 30000 });
  for (const [id, options] of [['negative-limit', "{limits:{maxDepth:'bad'}}"], ['negative-replace', '{replace:3}'], ['negative-unknown-limit', '{limits:{unbounded:true}}']]) {
    const file = join(output, id + '.mts');
    writeFileSync(file, `import {htmlToMarkdownCommands} from './build/commands/html-to-markdown/index.js'; htmlToMarkdownCommands(${options});\n`);
    assert.match(run(id, process.execPath, [...flags, file], { timeout: 30000, expectedStatus: 2 }), /TS(?:2322|2353)/u);
  }
  for (const [id, missing] of [['missing-entry', 'commands/html-to-markdown/index.js'], ['missing-dependency', 'contracts/index.js']]) {
    const copy = join(output, id); cpSync(build, copy, { recursive: true });
    renameSync(join(copy, missing), join(copy, missing + '.absent'));
    run(id, process.execPath, [join(own, 'worker.mjs'), copy, JSON.stringify({ id, input: '<b>x</b>' })], { expectedStatus: 1 });
    assert.match(readFileSync(join(output, id + '.stderr'), 'utf8'), /ERR_MODULE_NOT_FOUND/u);
  }
  const supervisor = spawnSync(process.execPath, ['-e', 'for (;;) {}'], { timeout: 100, killSignal: 'SIGKILL' });
  assert.equal(supervisor.error?.code, 'ETIMEDOUT'); assert.equal(supervisor.signal, 'SIGKILL');
  report.syntheticSupervisor = { status: supervisor.status, signal: supervisor.signal, code: supervisor.error.code, role: 'intentional non-product negative' };
  const forms = ['unterminated-quoted-attribute', 'repeated-less-than', 'rawtext-close-near-miss', 'long-entity', 'alternating-backticks', 'trim-internal-space', 'unresolved-entity-regex'];
  for (const form of forms) for (const size of [8192, 32768, 131072, 524288]) product({ id: form + '-' + size, form, size });
  for (const size of [32768, 131072, 524288]) product({ id: 'slash-neighbor-' + size, form: 'slash-attribute-neighbor', size });
  for (const abort of [100, 'immediate']) product({ id: 'abort-eof-' + abort, form: 'trim-internal-space', size: 131072, abort, limits: {} });
  const pandoc = '/opt/homebrew/bin/pandoc';
  report.pandoc = { path: realpathSync(pandoc), sha256: hash(readFileSync(pandoc)), version: run('pandoc-version', pandoc, ['--version']).split('\n')[0], role: 'CommonMark+strikeout parsing reference only' };
  assert.equal(report.pandoc.version, 'pandoc 3.10.1');
  assert.equal(report.pandoc.sha256, '61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d');
  const semantic = JSON.parse(readFileSync(join(own, 'semantics.json')));
  function characters(nodes, styles = []) {
    return nodes.flatMap(node => {
      if (node.t === 'Str') return [...node.c].map(character => [character, styles]);
      if (node.t === 'Space' || node.t === 'SoftBreak') return [[' ', styles]];
      if (node.t === 'Emph' || node.t === 'Strong' || node.t === 'Strikeout') return characters(node.c, [...styles, node.t]);
      assert.fail('unexpected Markdown node ' + JSON.stringify(node));
    });
  }
  for (const item of semantic) {
    const row = product({ id: item.id, input: item.html, returnOutput: true });
    assert.equal(row.exitCode, 0);
    const ast = JSON.parse(run(item.id + '-ast', pandoc, ['--sandbox', '--from=commonmark+strikeout', '--to=json'], { input: row.output }));
    assert.equal(ast.blocks.length, 1); assert.equal(ast.blocks[0].t, 'Para');
    const expected = item.runs.flatMap(([text, styles]) => [...text].map(character => [character, styles]));
    assert.deepEqual(characters(ast.blocks[0].c), expected, item.id);
    row.semantic = 'exact characters and nesting';
  }
  report.sourceAfter = inventory(join(root, 'src/commands/html-to-markdown')); report.emittedAfter = inventory(build);
  assert.deepEqual(report.sourceAfter, before); assert.deepEqual(report.emittedAfter, report.emittedBefore);
  report.sourceInputsAfter = sourceInputs(); assert.deepEqual(report.sourceInputsAfter, report.sourceInputsBefore);
  report.pass = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally { writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(output); }
