import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash, inventory, toolInventory, read, save, supervised } from '../../html-to-markdown-independent-20260827/fix-review-3ef5811f/common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..');
const revision = process.argv[2], label = process.argv[3], extended = process.argv.includes('--extended');
assert(/^[0-9a-f]{40}$/u.test(revision)); assert(/^[a-z0-9-]+$/u.test(label));
const capture = join(repo, 'src/commands/html-to-markdown/node_modules/inline-normalization-fix', label);
assert(!existsSync(capture)); mkdirSync(capture, { recursive: true });
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
const listing = git('ls-tree', '-rz', revision).toString().split('\0').filter(Boolean).map(line => {
  const separator = line.indexOf('\t'), metadata = line.slice(0, separator), path = line.slice(separator + 1), [mode, type, blob] = metadata.split(' ');
  return { mode, type, blob, path };
});
const regular = listing.filter(entry => entry.mode === '100644' || entry.mode === '100755');
const excluded = listing.filter(entry => entry.mode !== '100644' && entry.mode !== '100755');
const source = join(capture, 'candidate'), tools = join(capture, 'tools'), output = join(capture, 'compiled');
for (const directory of [source, tools, output, join(capture, 'home')]) mkdirSync(directory);
const state = { revision, label, extended, started: new Date().toISOString(), source, tools, output, capture, tree: git('rev-parse', revision + '^{tree}').toString().trim(), sourceTree: git('rev-parse', revision + ':src').toString().trim(), htmlTree: git('rev-parse', revision + ':src/commands/html-to-markdown').toString().trim(), regular, excludedNonregularGitEntries: excluded, rows: [], ast: [] };
async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
const npmRoot = realpathSync(join(dirname(process.execPath), '../lib/node_modules/npm'));
state.npm = join(npmRoot, 'bin/npm-cli.js'); state.npmBefore = toolInventory(npmRoot);
state.node = { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) };
state.pandoc = { path: realpathSync('/opt/homebrew/bin/pandoc'), sha256: hash(readFileSync('/opt/homebrew/bin/pandoc')) };
assert.equal(state.pandoc.sha256, '61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d');
state.drivers = Object.fromEntries(['capture.mjs', 'batch.mjs', 'CASES.json', 'NESTED.json', 'FREEZE.md'].map(name => [name, hash(readFileSync(join(own, name)))]));
const env = { PATH: dirname(process.execPath), HOME: join(capture, 'home'), TMPDIR: capture, npm_config_cache: join(capture, 'npm-cache'), npm_config_userconfig: join(capture, 'absent-user-npmrc'), npm_config_globalconfig: join(capture, 'absent-global-npmrc'), npm_config_update_notifier: 'false', npm_config_audit: 'false', TSX_DISABLE_CACHE: '1' };
save(join(capture, 'PRE.json'), state);
for (const name of Object.keys(state.drivers)) cpSync(join(own, name), join(capture, name));
async function command(phase, id, args, options = {}) {
  const row = await supervised(join(capture, phase), id, options.executable ?? process.execPath, args, { cwd: options.cwd ?? capture, env: { ...env, ...options.env }, deadlineMs: 30000, driver: state.drivers['capture.mjs'], inputs: { revision, htmlTree: state.htmlTree }, ...options });
  state.rows.push({ ...row, phase });
  console.log(JSON.stringify({ phase, id, outcome: row.outcome, ms: Math.round(row.elapsedMs) }));
  return row;
}
async function required(phase, id, args, options) {
  const row = await command(phase, id, args, options); assert.equal(row.outcome, 'PASS', phase + '/' + id); return row;
}
function verifySource() {
  const files = inventory(source);
  assert.deepEqual(Object.keys(files).sort(), regular.map(entry => entry.path).sort());
  for (const entry of regular) {
    const bytes = readFileSync(join(source, entry.path));
    assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), entry.blob, entry.path);
  }
  return files;
}
try {
  const archive = join(capture, 'candidate.tar');
  await required('setup', 'git-archive', ['--no-replace-objects', 'archive', '--format=tar', '--output=' + archive, revision], { executable: '/usr/bin/git', cwd: repo, deadlineMs: 180000 });
  state.archiveSHA256 = await hashFile(archive);
  await required('setup', 'extract', ['-xf', archive, '-C', source, ...excluded.flatMap(entry => ['--exclude', entry.path])], { executable: '/usr/bin/tar', deadlineMs: 180000 });
  state.sourceBefore = verifySource();
  if (extended) for (const [name, digest] of Object.entries(state.drivers)) assert.equal(state.sourceBefore['tests/commands/html-to-markdown/inline-normalization-fix/' + name], digest);
  state.lockSHA256 = state.sourceBefore['package-lock.json'];
  cpSync(join(repo, 'node_modules'), join(tools, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  state.toolsBefore = toolInventory(tools);
  const lock = read(join(source, 'package-lock.json'));
  for (const name of ['typescript', 'tsx', 'esbuild', '@types/node', 'undici-types']) assert.equal(read(join(tools, 'node_modules', name, 'package.json')).version, lock.packages['node_modules/' + name].version);
  state.compiler = { path: join(tools, 'node_modules/typescript/bin/tsc'), sha256: hash(readFileSync(join(tools, 'node_modules/typescript/bin/tsc'))) };
  const closure = new Set();
  function collect(path) {
    if (closure.has(path)) return;
    closure.add(path);
    for (const match of readFileSync(join(source, path), 'utf8').matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/gu)) {
      const dependency = posix.normalize(posix.join(posix.dirname(path), match[1])).replace(/\.js$/u, '.ts');
      if (dependency.endsWith('.ts')) collect(dependency);
    }
  }
  for (const path of ['src/commands/html-to-markdown/index.ts', 'src/fs/memory/index.ts', 'src/shell/index.ts']) collect(path);
  const config = join(capture, 'build.json');
  save(config, { extends: join(source, 'tsconfig.build.json'), compilerOptions: { rootDir: join(source, 'src'), outDir: join(output, 'dist'), typeRoots: [join(tools, 'node_modules/@types')], types: ['node'] }, files: [...closure].sort().map(path => join(source, path)), include: [], exclude: [] });
  save(join(capture, 'BOUND.json'), { ...state, buildConfigSHA256: hash(readFileSync(config)) });
  await required('setup', 'compile', [state.compiler.path, '-p', config, '--listFiles']);
  state.compilerInputs = {};
  for (const path of readFileSync(join(capture, 'setup/compile.stdout'), 'utf8').trim().split('\n')) {
    assert(path.startsWith(source + '/') || path.startsWith(tools + '/'));
    state.compilerInputs[path] = hash(readFileSync(path));
  }
  cpSync(join(source, 'package.json'), join(output, 'package.json'));
  state.emittedBefore = inventory(output);
  const packed = await required('setup', 'pack', [state.npm, 'pack', '--offline', '--ignore-scripts', '--json'], { cwd: output });
  const pack = JSON.parse(readFileSync(join(capture, 'setup/pack.stdout')))[0];
  const tarball = join(output, pack.filename); state.packageSHA256 = hash(readFileSync(tarball)); state.pack = pack;
  const installation = join(capture, 'installation'); mkdirSync(installation); save(join(installation, 'package.json'), { private: true, type: 'module' });
  await required('setup', 'install', [state.npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: installation });
  const moved = join(capture, 'moved/node_modules/virtual-bash'); mkdirSync(dirname(moved), { recursive: true });
  renameSync(join(installation, 'node_modules/virtual-bash'), moved);
  state.moved = moved; state.movedBefore = inventory(moved);
  assert.deepEqual(inventory(join(moved, 'dist')), inventory(join(output, 'dist')));
  assert.equal(Object.keys(read(join(moved, 'package.json')).dependencies ?? {}).length, 0);
  const sourceOwn = join(source, 'tests/commands/html-to-markdown/inline-normalization-fix');
  const review = join(source, 'tests/commands/html-to-markdown-independent-20260827/fix-review-3ef5811f');
  const legacy = join(source, 'tests/commands/html-to-markdown-independent-20260827');
  assert.deepEqual(read(join(sourceOwn, 'CASES.json')).slice(0, 10).map(({ id, input, runs }) => ({ id, input, runs })), read(join(review, 'NEIGHBORS.json')));
  assert.equal(hash(readFileSync(join(sourceOwn, 'CASES.json'))), state.drivers['CASES.json']);
  if (extended) {
    const originals = ['render', 'io', 'limits', 'adversarial', 'repair'].map(name => join(source, 'tests/commands/html-to-markdown', name + '.test.ts'));
    const additions = ['regression.test.ts', 'bounds.test.ts'].map(name => join(sourceOwn, name));
    for (const [id, files] of [['author154', originals], ['new52', additions]]) await required('validation', id, ['--import', join(tools, 'node_modules/tsx/dist/loader.mjs'), '--test', ...files]);
    const types = join(capture, 'types.json');
    save(types, { extends: join(source, 'tsconfig.json'), compilerOptions: { noEmit: true, typeRoots: [join(tools, 'node_modules/@types')] }, files: [...closure].sort().map(path => join(source, path)).concat(originals, additions), include: [], exclude: [] });
    await required('validation', 'strict-scoped-types', [state.compiler.path, '-p', types]);
  }
  for (const [layout, root] of [['source', output], ['moved', moved]]) {
    const harness = join(capture, 'harness-' + layout); mkdirSync(harness);
    for (const name of ['probe.mjs', 'adjacent-probe.mjs']) cpSync(join(review, name), join(harness, name));
    for (const name of ['audit-loader.mjs', 'consumer.mjs', 'supplemental-consumer.mjs', 'frozen-cases.mjs']) cpSync(join(legacy, name), join(harness, name));
    cpSync(join(own, 'batch.mjs'), join(harness, 'batch.mjs'));
    cpSync(join(source, 'tests/commands/html-to-markdown/fix-review/worker.mjs'), join(harness, 'worker.mjs'));
    const flags = ['--permission', '--allow-fs-read=' + harness, '--allow-fs-read=' + root + '/dist', '--allow-fs-read=' + root + '/package.json', '--import', join(harness, 'audit-loader.mjs')];
    const runtimeInventory = inventory(root);
    async function product(phase, id, script, args) {
      const before = inventory(harness);
      const row = await command(layout + '-' + phase, id, [...flags, join(harness, script), ...args], { env: { ...env, REVIEW_PACKAGE: root, REVIEW_POISON: join(source, 'src/commands/html-to-markdown/index.ts') }, cwd: harness, deadlineMs: 10000 });
      assert.equal(row.killed, false); assert.equal(row.processGroupGone, true);
      for (const load of row.loads) {
        const path = fileURLToPath(load.url);
        assert(path.startsWith(root + '/dist/') || path.startsWith(harness + '/'));
        assert.equal(load.sha256, path.startsWith(root + '/') ? runtimeInventory[path.slice(root.length + 1)] : before[path.slice(harness.length + 1)]);
      }
      assert(row.loads.some(load => load.url.endsWith('/commands/html-to-markdown/render.js')));
      return row;
    }
    async function probe(phase, fixture, script = 'probe.mjs') {
      const path = join(harness, phase + '-' + fixture.id + '.json'); save(path, fixture);
      return product(phase, fixture.id, script, [path]);
    }
    const cohorts = [['new34', read(join(sourceOwn, 'CASES.json'))], ['author22', read(join(source, 'tests/commands/html-to-markdown/fix-review/semantics.json'))]];
    if (extended) cohorts.push(['nested3', read(join(sourceOwn, 'NESTED.json'))]);
    for (const [cohort, cases] of cohorts) {
      const path = join(harness, cohort + '.json'); save(path, cases);
      const result = await product('semantic', cohort, 'batch.mjs', [path]);
      for (const [index, item] of cases.entries()) {
        const actual = result.result.rows[index];
        const native = await required(layout + '-ast', cohort + '-' + item.id, ['--sandbox', '--from=commonmark+strikeout', '--to=json'], { executable: state.pandoc.path, input: actual.markdown });
        const tree = JSON.parse(readFileSync(join(capture, layout + '-ast', cohort + '-' + item.id + '.stdout')));
        const observed = [], structures = [];
        function visit(node, styles = []) {
          if (Array.isArray(node)) { for (const child of node) visit(child, styles); return; }
          if (!node || typeof node !== 'object') return;
          structures.push(node.t);
          const append = text => { for (const character of text) observed.push([character, styles]); };
          if (['Emph', 'Strong', 'Strikeout'].includes(node.t)) visit(node.c, [...styles, node.t]);
          else if (node.t === 'Str') append(node.c);
          else if (['Space', 'SoftBreak'].includes(node.t)) append(' ');
          else if (node.t === 'LineBreak') append('\n');
          else if (node.t === 'Code') for (const character of node.c[1]) observed.push([character, [...styles, 'Code']]);
          else visit(node.c, styles);
        }
        visit(tree.blocks);
        let error;
        try {
          assert.equal(tree.blocks.length, 1); assert.equal(tree.blocks[0].t, 'Para');
          assert(!structures.some(type => ['OrderedList', 'BulletList', 'RawInline', 'RawBlock'].includes(type)));
          if (item.runs) assert.deepEqual(observed, item.runs.flatMap(([text, styles]) => [...text].map(character => [character, styles])));
          if (item.atoms) assert.deepEqual(structures.filter(type => ['Link', 'Image'].includes(type)), item.atoms);
        } catch (failure) { error = failure.stack; }
        state.ast.push({ layout, cohort, ...item, actual, observed, structures, outcome: error ? 'FAIL' : 'PASS', error });
      }
    }
    if (extended) {
      const { stressForms, stressScales } = await import(pathToFileURL(join(harness, 'frozen-cases.mjs')));
      for (const form of [...stressForms, 'trim-internal-space', 'unresolved-entity-regex']) for (const size of stressScales) {
        const forms = { 'unterminated-quoted-attribute': () => '<a title="' + 'x'.repeat(size), 'repeated-less-than': () => '<'.repeat(size), 'rawtext-close-near-miss': () => '<script>' + '</scripX>'.repeat(Math.ceil(size / 9)), 'long-entity': () => '&' + 'x'.repeat(size) + ';', 'alternating-backticks': () => '<pre>' + '` '.repeat(size / 2) + '</pre>', 'trim-internal-space': () => '<pre>x' + ' '.repeat(size) + 'x</pre>', 'unresolved-entity-regex': () => '<a href="' + '&#'.repeat(size / 2) + '">label</a>' };
        const id = form + '-' + size, fixture = join(harness, id + '.json');
        save(fixture, { input: forms[form](), limits: { maxTokenBytes: 1048576, maxTokens: 1000000, maxNodes: 1000000 } });
        const row = await product('stress28', id, 'consumer.mjs', ['custom', fixture]);
        if (form === 'trim-internal-space' || form === 'unresolved-entity-regex') {
          const expected = form === 'trim-internal-space' ? '```\nx' + ' '.repeat(size) + 'x\n```\n' : '[label](<' + '&#'.repeat(size / 2) + '>)\n';
          assert.deepEqual([row.result.actual.exitCode, row.result.actual.stdout, row.result.actual.stderr], [0, expected, '']);
        }
        await product('author55', id, 'worker.mjs', [root + '/dist', JSON.stringify({ id, form, size })]);
      }
      for (const size of [32768, 131072, 524288]) await product('author55', 'slash-' + size, 'worker.mjs', [root + '/dist', JSON.stringify({ id: 'slash-' + size, form: 'slash-attribute-neighbor', size })]);
      for (const abort of [100, 'immediate']) await product('author55', 'abort-' + abort, 'worker.mjs', [root + '/dist', JSON.stringify({ id: 'abort-' + abort, form: 'trim-internal-space', size: 131072, abort, limits: {} })]);
      for (const entry of read(join(source, 'tests/commands/html-to-markdown/fix-review/semantics.json'))) await product('author55', entry.id, 'worker.mjs', [root + '/dist', JSON.stringify({ id: entry.id, input: entry.html, returnOutput: true })]);
      for (const fixture of read(join(review, 'EXPECTATION-v2.json')).cases) await probe('policy-v2', { ...fixture, everyByteSplit: true });
      const trim = '<pre>x' + ' '.repeat(131072) + 'x</pre>', destination = '<a href="' + '&#'.repeat(65536) + '">label</a>';
      for (const [name, input, limits] of [['trim', trim, undefined], ['destination', destination, { maxTokenBytes: 1048576 }]]) for (let repeat = 1; repeat <= 3; repeat++) await probe('controlled-abort', { id: name + '-' + repeat, action: 'abort', mode: 'in-flight', input, limits });
      for (const mode of ['no-trigger', 'pre-abort', 'old-timer-observation']) await probe('abort-controls', { id: mode, action: 'abort', mode, input: trim, stdout: '```\nx' + ' '.repeat(131072) + 'x\n```\n' });
      await probe('edge-controls', { id: 'all', action: 'edges' }, 'adjacent-probe.mjs');
      for (const input of ['<em>a</em>' + '<b><span><em></em></span></b><a></a><code></code>'.repeat(8192) + '<i>b</i>', Array.from({ length: 4096 }, () => '<em><b>a</b></em><a></a><i><strong>b</strong></i>').join('')]) await probe('normalization-abort', { id: String(input.length), action: 'abort', mode: 'in-flight', input });
      for (const operation of ['trim', 'normalize', 'destination', 'entities']) await probe('scan-abort', { id: operation, action: 'scan-abort', operation }, 'adjacent-probe.mjs');
      for (const [operation, input] of [['trim', ' '.repeat(32768) + 'x'], ['normalize', 'a '.repeat(16384)], ['entities', '&amp;'.repeat(8192)], ['escape', '*'.repeat(32768)], ['destination', '&#'.repeat(16384)], ['language', 'x'.repeat(32768)], ['fence', '` '.repeat(16384)], ['tag', '<a ' + '/ '.repeat(16384) + '>']]) await probe('direct-work', { id: operation, action: 'direct-work', operation, input, work: 4096 });
      for (const operation of ['filesystem', 'fetch', 'child', 'net']) await probe('host-negative', { id: operation, action: 'host-negative', operation });
      const prefix = `import {createHtmlToMarkdownCommand, htmlToMarkdownCommands} from ${JSON.stringify(root + '/dist/commands/html-to-markdown/index.js')};\n`;
      for (const [id, text, expectedStatus] of [['positive', 'createHtmlToMarkdownCommand({limits:{maxWorkUnits:4096}}); htmlToMarkdownCommands({replace:true});', 0], ['wrong-limit', 'createHtmlToMarkdownCommand({limits:{maxWorkUnits:"bad"}});', 2], ['wrong-replace', 'htmlToMarkdownCommands({replace:1});', 2], ['unknown-limit', 'createHtmlToMarkdownCommand({limits:{imaginary:1}});', 2]]) {
        const path = join(harness, id + '.mts'); writeFileSync(path, prefix + text);
        await required(layout + '-types', id, [state.compiler.path, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--target', 'ES2023', '--typeRoots', join(tools, 'node_modules/@types'), path], { expectedStatus, expectedError: expectedStatus ? 'TS(?:2322|2353)' : undefined });
      }
    }
    assert.deepEqual(inventory(root), runtimeInventory);
  }
  state.sourceAfter = verifySource(); assert.deepEqual(state.sourceAfter, state.sourceBefore);
  assert.deepEqual(toolInventory(tools), state.toolsBefore); assert.deepEqual(toolInventory(npmRoot), state.npmBefore);
  assert.deepEqual(inventory(moved), state.movedBefore);
  assert.equal(hash(readFileSync(process.execPath)), state.node.sha256);
  assert.equal(hash(readFileSync(state.pandoc.path)), state.pandoc.sha256);
  assert.equal(await hashFile(join(capture, 'candidate.tar')), state.archiveSHA256);
  for (const [name, digest] of Object.entries(state.drivers)) assert.equal(hash(readFileSync(join(own, name))), digest);
  state.membershipVerifiedBeforeAfterIncludingNewEntries = true;
} catch (error) { state.error = error.stack; process.exitCode = 1; }
finally {
  state.finished = new Date().toISOString();
  state.counts = Object.fromEntries(['source', 'moved'].map(layout => [layout, Object.fromEntries(['new34', 'author22', 'nested3'].map(cohort => {
    const rows = state.ast.filter(row => row.layout === layout && row.cohort === cohort);
    return [cohort, { count: rows.length, astPass: rows.filter(row => row.outcome === 'PASS').length, astFail: rows.filter(row => row.outcome === 'FAIL').length, exactPass: rows.filter(row => row.actual.outcome === 'PASS').length, exactFail: rows.filter(row => row.actual.outcome === 'FAIL').length }];
  }))]));
  save(join(capture, 'RESULT.json'), state);
  console.log(JSON.stringify({ capture, counts: state.counts, error: state.error }));
}
