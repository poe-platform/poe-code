import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash, inventory, toolInventory, read, save, supervised } from './common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), capture = join(own, process.argv[2] ?? 'run01');
const state = read(join(capture, 'state.json'));
const driver = hash(readFileSync(new URL(import.meta.url)));
assert.equal(driver, state.scriptsBefore['run.mjs']);
assert.equal(hash(readFileSync(join(own, 'common.mjs'))), state.scriptsBefore['common.mjs']);
const { cases, stressForms, stressScales } = await import(pathToFileURL(join(state.legacy, 'frozen-cases.mjs')));
const rows = [], astRows = [];
const env = root => ({ PATH: dirname(process.execPath), HOME: state.consumer, TMPDIR: state.work, REVIEW_PACKAGE: root, REVIEW_POISON: state.poisonedSource });
const digest = value => hash(Buffer.from(JSON.stringify(value)));
const runRoot = join(capture, 'replay'); assert(!existsSync(runRoot)); mkdirSync(runRoot);
for (const layout of ['isolated', 'moved']) {
  const root = layout === 'isolated' ? state.isolated : state.installed, expectedTree = layout === 'isolated' ? state.isolatedBefore : state.installedBefore;
  assert.deepEqual(inventory(root), expectedTree);
  const harness = join(state.consumer, 'harness-' + layout); mkdirSync(harness);
  for (const name of ['consumer.mjs', 'supplemental-consumer.mjs', 'frozen-cases.mjs', 'audit-loader.mjs']) cpSync(join(state.legacy, name), join(harness, name));
  cpSync(join(own, 'probe.mjs'), join(harness, 'probe.mjs'));
  const permissions = ['--permission', '--allow-fs-read=' + harness, '--allow-fs-read=' + root + '/dist', '--allow-fs-read=' + root + '/package.json', '--import', join(harness, 'audit-loader.mjs')];
  async function invoke(phase, id, args, options = {}) {
    const directory = join(runRoot, layout, phase);
    const inputs = { packageInventory: digest(expectedTree), harness: inventory(harness), tools: digest(state.toolchain), source: state.source, freeze: state.freeze };
    const row = await supervised(directory, id, options.executable ?? process.execPath, args, { cwd: state.consumer, env: env(root), driver, inputs, ...options });
    for (const load of row.loads) {
      const path = fileURLToPath(load.url);
      assert(path.startsWith(root + '/dist/') || path.startsWith(harness + '/'), 'unexpected runtime load: ' + path);
      assert.equal(load.sha256, path.startsWith(root + '/') ? expectedTree[path.slice(root.length + 1)] : inputs.harness[path.slice(harness.length + 1)], 'actual runtime bytes: ' + path);
    }
    row.layout = layout; row.phase = phase; rows.push(row);
    console.log(JSON.stringify({ layout, phase, id, outcome: row.outcome, killed: row.killed, ms: Math.round(row.elapsedMs) }));
    return row;
  }
  const legacy = (phase, id, consumer = 'consumer.mjs', extra = [], options = {}) => invoke(phase, id, [...permissions, join(harness, consumer), id, ...extra], options);
  async function probe(phase, test, options = {}) {
    const fixture = join(harness, phase + '-' + test.id + '.json'); save(fixture, test);
    const row = await invoke(phase, test.id, [...permissions, join(harness, 'probe.mjs'), fixture], options);
    cpSync(fixture, join(runRoot, layout, phase, test.id + '.input.json')); return row;
  }
  for (const test of cases) await legacy('frozen-original', test.id, 'consumer.mjs', [], { deadlineMs: test.deadlineMs });
  for (const test of read(join(state.legacy, 'frozen-protocols.json')).filter(test => test.id.startsWith('P') || test.id === 'N02-poisoned-source')) await legacy('frozen-original', test.id);
  for (const id of ['L02-heading-paragraph', 'L06-raw-ordinary-text', 'U-title-alt-injection', 'B10-files', 'B11-args', 'P11-shell-middleware']) await legacy('corrections-v2', id + '-v2', 'supplemental-consumer.mjs');
  for (const test of read(join(state.legacy, 'followup-semantic.json'))) {
    const fixture = join(harness, test.id + '.json'); save(fixture, test);
    const row = await invoke('semantic-original', test.id, [...permissions, join(harness, 'supplemental-consumer.mjs'), 'custom', fixture]);
    cpSync(fixture, join(runRoot, layout, 'semantic-original', test.id + '.input.json'));
    if (test.id === 'R04-numeric-entity-token-boundary' || test.id === 'R05-entity-token-boundary') row.policyClassification = 'raw original failure, superseded ONLY by separately frozen v2';
  }
  for (const test of read(join(own, 'EXPECTATION-v2.json')).cases) await probe('policy-v2', { ...test, everyByteSplit: true });
  for (const [id, input, caps, stdout] of [
    ['amp', '&amp;', [5, 6], '\\&\n'], ['numeric', '<p>&#1114112;</p>', [10, 11], '�\n'],
    ['prefix-amp', 'x&amp;y', [5, 6], 'x\\&y\n'], ['prefix-numeric', 'x&#1114112;y', [10, 11], 'x�y\n'],
    ['textarea', '<textarea>x&amp;y&#1114112;</textarea>', [16], 'x\\&y�\n'],
    ['title', '<title>x&amp;y</title>', [8], 'x\\&y\n'],
  ]) for (const cap of caps) await probe('valid-boundaries', { id: id + '-' + cap, input, limits: { maxTokenBytes: cap }, stdout, everyByteSplit: true });
  for (const form of [...stressForms, 'trim-internal-space', 'unresolved-entity-regex']) for (const size of stressScales) {
    const forms = { 'unterminated-quoted-attribute': () => '<a title="' + 'x'.repeat(size), 'repeated-less-than': () => '<'.repeat(size), 'rawtext-close-near-miss': () => '<script>' + '</scripX>'.repeat(Math.ceil(size / 9)), 'long-entity': () => '&' + 'x'.repeat(size) + ';', 'alternating-backticks': () => '<pre>' + '` '.repeat(size / 2) + '</pre>', 'trim-internal-space': () => '<pre>x' + ' '.repeat(size) + 'x</pre>', 'unresolved-entity-regex': () => '<a href="' + '&#'.repeat(size / 2) + '">label</a>' };
    const fixture = join(harness, form + '-' + size + '.json'); save(fixture, { input: forms[form](), limits: { maxTokenBytes: 1048576, maxTokens: 1000000, maxNodes: 1000000 } });
    const row = await invoke('stress-original', form + '-' + size, [...permissions, join(harness, 'consumer.mjs'), 'custom', fixture]);
    cpSync(fixture, join(runRoot, layout, 'stress-original', row.id + '.input.json'));
    if (form === 'trim-internal-space' || form === 'unresolved-entity-regex') {
      const expected = form === 'trim-internal-space' ? '```\nx' + ' '.repeat(size) + 'x\n```\n' : '[label](<' + '&#'.repeat(size / 2) + '>)\n';
      const actual = row.result?.actual;
      row.extraExact = actual?.exitCode === 0 && actual?.stdout === expected && actual?.stderr === '';
    }
  }
  for (const id of ['shared-counters', 'primary-cleanup-error', 'vfs-stream-signal-and-boundary', 'literal-file-cli-and-no-host']) await legacy('supplemental-original', id, 'supplemental-consumer.mjs');
  await invoke('supplemental-original', 'poison-sentinel-live', [state.poisonedSource], { expectedStatus: 1, expectedError: 'POISONED_RETIRED_SOURCE_MUST_NOT_LOAD' });
  await invoke('supplemental-original', 'unexported-leaf-control', ['--input-type=module', '-e', "await import('virtual-bash/commands/html-to-markdown')"], { expectedStatus: 1, expectedError: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  await legacy('old-abort-original', 'abort-during-trim', 'supplemental-consumer.mjs');
  const trim = '<pre>x' + ' '.repeat(131072) + 'x</pre>', destination = '<a href="' + '&#'.repeat(65536) + '">label</a>';
  for (const mode of ['old-timer-observation', 'pre-abort', 'no-trigger']) await probe('abort-observation', { id: mode, action: 'abort', mode, input: trim, stdout: '```\nx' + ' '.repeat(131072) + 'x\n```\n' });
  for (const [name, input, limits] of [['trim', trim, undefined], ['destination', destination, { maxTokenBytes: 1048576 }]]) for (let repeat = 1; repeat <= 3; repeat++) await probe('in-flight-abort', { id: name + '-' + repeat, action: 'abort', mode: 'in-flight', input, limits });
  for (const [operation, input] of [['trim', ' '.repeat(32768) + 'x'], ['normalize', 'a '.repeat(16384)], ['entities', '&amp;'.repeat(8192)], ['escape', '*'.repeat(32768)], ['destination', '&#'.repeat(16384)], ['language', 'x'.repeat(32768)], ['fence', '` '.repeat(16384)], ['tag', '<a ' + '/ '.repeat(16384) + '>']]) await probe('adjacent-work', { id: operation, action: 'direct-work', operation, input, work: 4096 });
  for (const size of [8192, 32768, 131072]) await probe('slash-neighbor', { id: 'slash-' + size, input: '<a ' + '/ '.repeat(size) + '>x</a>', limits: { maxTokenBytes: 1048576, maxWorkUnits: 4096 }, status: 1, stdout: '', stderr: 'html-to-markdown: EFBIG: html-to-markdown work limit exceeded\n' });
  for (const operation of ['filesystem', 'fetch', 'child', 'net']) await probe('host-negative', { id: operation, action: 'host-negative', operation });
  for (const [id, file] of [['missing-entry', 'index.js'], ['missing-dependency', 'parser.js']]) {
    const path = join(root, 'dist/commands/html-to-markdown', file); renameSync(path, path + '.held');
    try { await legacy('denials', id, 'consumer.mjs', [], { expectedStatus: 1, expectedError: 'ERR_MODULE_NOT_FOUND' }); } finally { renameSync(path + '.held', path); }
  }
  for (const id of ['N05-wrong-literal', 'N05-tiny-budget']) await legacy('denials', id, 'consumer.mjs', [], { expectedStatus: 1, expectedError: 'AssertionError' });
  await invoke('denials', 'direct-source-permission', ['--permission', '--allow-fs-read=' + harness, '--input-type=module', '-e', `import {readFileSync} from 'node:fs';readFileSync(${JSON.stringify(state.poisonedSource)})`], { expectedStatus: 1, expectedError: 'ERR_ACCESS_DENIED' });
  const prefix = `import { createHtmlToMarkdownCommand, htmlToMarkdownCommands, type HtmlToMarkdownLimits } from ${JSON.stringify(root + '/dist/commands/html-to-markdown/index.js')};\n`;
  for (const [id, text, expectedStatus] of [['positive', 'const limits: Partial<HtmlToMarkdownLimits> = {maxWorkUnits:4096}; createHtmlToMarkdownCommand({limits}); htmlToMarkdownCommands({replace:true});', 0], ['unknown-limit', 'createHtmlToMarkdownCommand({limits:{imaginary:3}});', 2], ['wrong-limit', 'createHtmlToMarkdownCommand({limits:{maxInputBytes:"4"}});', 2], ['wrong-replace', 'htmlToMarkdownCommands({replace:1});', 2]]) {
    const fixture = join(harness, id + '.mts'); writeFileSync(fixture, prefix + text);
    await invoke('types', id, [join(state.tools, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2023', '--typeRoots', join(state.tools, 'node_modules/@types'), fixture], { deadlineMs: 15000, expectedStatus, expectedError: expectedStatus ? 'TS(?:2353|2322)' : undefined });
    cpSync(fixture, join(runRoot, layout, 'types', id + '.mts.fixture'));
  }
  await invoke('supervisor-negative', 'busy-loop', ['-e', 'while(true){}'], { deadlineMs: 150, intentionalKill: true });
  const semantic = read(join(state.author, 'semantics.json')).map(test => ({ ...test, origin: 'author22-unchanged' }));
  semantic.push(...[
    { id: 'ind-code', html: '<code>1. ~~x~~ = *</code>', runs: [['1. ~~x~~ = *', ['Code']]] },
    { id: 'ind-setext', html: '<p>ordinary<br>===</p>', runs: [['ordinary\n===', []]] },
    { id: 'ind-split-period', html: '1<span>.</span> ordinary', runs: [['1. ordinary', []]] },
    { id: 'ind-mixed-nest-a', html: '<b><em>x</em></b><em>y</em>', runs: [['x', ['Strong','Emph']], ['y', ['Emph']]] },
    { id: 'ind-mixed-nest-b', html: '<em><b>x</b></em><b>y</b>', runs: [['x', ['Emph','Strong']], ['y', ['Strong']]] },
    { id: 'ind-space-between', html: '<em>a</em> <em>b</em>', runs: [['a', ['Emph']], [' ', []], ['b', ['Emph']]] },
    { id: 'ind-style-space', html: 'a<em> b </em>c', runs: [['a ', []], ['b', ['Emph']], [' c', []]] },
    { id: 'ind-punctuation', html: 'a<em>(x)</em>b', runs: [['a', []], ['(x)', ['Emph']], ['b', []]] },
    { id: 'ind-literal-entity', html: '&amp;#42; &#42; &unknown;', runs: [['&#42; * &unknown;', []]] },
    { id: 'ind-strong-strike', html: '<strong>a</strong><del>b</del>', runs: [['a', ['Strong']], ['b', ['Strikeout']]] },
  ].map(test => ({ ...test, origin: 'independent-neighbor' })));
  for (const test of semantic) {
    const output = await probe('semantic-conversion', { id: test.id, input: test.html });
    const markdown = output.result?.actual?.stdout ?? '';
    const native = await invoke('semantic-parser', test.id, ['--sandbox', '--from=commonmark+strikeout', '--to=json'], { executable: state.pandoc, input: markdown });
    let observed, failure;
    try {
      assert.equal(output.outcome, 'PASS'); assert.equal(native.outcome, 'PASS');
      const tree = JSON.parse(readFileSync(join(runRoot, layout, 'semantic-parser', test.id + '.stdout')));
      const characters = [];
      const append = (text, styles) => { for (const character of text) characters.push([character, styles]); };
      function visit(node, styles = []) {
        if (Array.isArray(node)) { for (const child of node) visit(child, styles); return; }
        assert(node && typeof node === 'object');
        if (['Para', 'Plain'].includes(node.t)) visit(node.c, styles);
        else if (['Emph', 'Strong', 'Strikeout'].includes(node.t)) visit(node.c, [...styles, node.t]);
        else if (node.t === 'Str') append(node.c, styles);
        else if (node.t === 'Space' || node.t === 'SoftBreak') append(' ', styles);
        else if (node.t === 'LineBreak') append('\n', styles);
        else if (node.t === 'Code') append(node.c[1], [...styles, 'Code']);
        else throw new Error('unexpected structure ' + node.t);
      }
      visit(tree.blocks); observed = characters;
      assert.deepEqual(observed, test.runs.flatMap(([text, styles]) => [...text].map(character => [character, styles])));
    } catch (error) { failure = error.stack; }
    astRows.push({ layout, ...test, markdown, observed, outcome: failure ? 'FAIL' : 'PASS', error: failure });
  }
  assert.deepEqual(inventory(root), expectedTree, 'post-run tree including additions/deletions');
  save(join(capture, layout + '-summary.json'), { at: new Date().toISOString(), rows: rows.filter(row => row.layout === layout), ast: astRows.filter(row => row.layout === layout) });
}
assert.deepEqual(inventory(state.isolated), state.isolatedBefore);
assert.deepEqual(inventory(state.installed), state.installedBefore);
assert.deepEqual(inventory(state.legacy), state.legacyBefore);
assert.deepEqual(inventory(state.author), state.authorBefore);
for (const name of ['typescript', '@types/node', 'undici-types']) assert.deepEqual(inventory(join(state.tools, 'node_modules', name)), state.toolchain[name].files);
assert.deepEqual(toolInventory(state.npmRoot), state.toolchain.npm.files);
assert.equal(hash(readFileSync(process.execPath)), state.toolchain.node.sha256);
assert.equal(hash(readFileSync(state.pandoc)), state.toolchain.pandoc.sha256);
save(join(capture, 'RESULTS.json'), { finished: new Date().toISOString(), inventoriesUnchangedIncludingNewEntries: true, rows, astRows });
console.log(JSON.stringify({ receipts: rows.length, rawPass: rows.filter(row => row.outcome === 'PASS').length, rawFail: rows.filter(row => row.outcome === 'FAIL').length, intentionalKills: rows.filter(row => row.outcome === 'EXPECTED_SUPERVISOR_KILL').length, astPass: astRows.filter(row => row.outcome === 'PASS').length, astFail: astRows.filter(row => row.outcome === 'FAIL').length }));
