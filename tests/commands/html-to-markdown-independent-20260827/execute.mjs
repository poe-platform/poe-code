import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, stressScales, stressForms } from './frozen-cases.mjs';

const own = dirname(fileURLToPath(import.meta.url));
const capture = join(own, process.argv[2] ?? 'capture-01');
const state = JSON.parse(readFileSync(join(capture, 'state.json')));
const phase = process.argv[3] ?? 'frozen';
const raw = join(capture, phase);
assert(!existsSync(raw), 'unique execution directory required'); mkdirSync(raw);
const harness = join(state.consumer, 'harness-' + phase); mkdirSync(harness);
for (const name of ['consumer.mjs', 'supplemental-consumer.mjs', 'frozen-cases.mjs', 'audit-loader.mjs']) copyFileSync(join(own, name), join(harness, name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [];
function inventory(directory, prefix = '', result = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) inventory(join(directory, entry.name), prefix + entry.name + '/', result);
    else { assert(entry.isFile()); result[prefix + entry.name] = hash(readFileSync(join(directory, entry.name))); }
  }
  return result;
}
async function supervised(id, args, options = {}) {
  const start = performance.now(); const stdout = [], stderr = []; let killed = false;
  const executable = options.executable ?? process.execPath;
  const child = spawn(executable, args, { cwd: state.consumer, detached: true, env: { PATH: dirname(process.execPath), HOME: state.consumer, TMPDIR: state.scratch, REVIEW_PACKAGE: state.installed, REVIEW_POISON: state.poisonedSource }, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  if (options.input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(options.input); }
  child.stdout.on('data', bytes => stdout.push(bytes)); child.stderr.on('data', bytes => stderr.push(bytes));
  const deadlineMs = options.deadlineMs ?? 5000;
  const timer = setTimeout(() => { killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, deadlineMs);
  const result = await new Promise(resolve => { child.on('error', error => resolve({ status: null, signal: null, error: error.message })); child.on('close', (status, signal) => resolve({ status, signal })); });
  clearTimeout(timer);
  let processGroupGone = false; try { process.kill(-child.pid, 0); } catch (error) { processGroupGone = error.code === 'ESRCH'; }
  const out = Buffer.concat(stdout).toString(), err = Buffer.concat(stderr).toString();
  writeFileSync(join(raw, id + '.stdout'), out); writeFileSync(join(raw, id + '.stderr'), err);
  const loads = err.split('\n').filter(line => line.startsWith('LOAD ')).map(line => JSON.parse(line.slice(5)));
  for (const load of loads.filter(load => load.url.includes('/node_modules/virtual-bash/'))) {
    const relative = fileURLToPath(load.url).slice(state.installed.length + 1);
    assert.equal(load.sha256, state.installedBefore[relative], relative);
  }
  const row = { id, executable, args, ...result, elapsedMs: performance.now() - start, deadlineMs, killed, pid: child.pid, processGroupGone, loads, stdoutSha256: hash(out), stderrSha256: hash(err) };
  const last = out.trim().split('\n').at(-1); try { row.result = JSON.parse(last); } catch {}
  row.outcome = killed ? 'FAIL' : result.status === (options.expectedStatus ?? 0) ? 'PASS' : 'FAIL';
  if (options.expectedError && !new RegExp(options.expectedError).test(out + err)) row.outcome = 'FAIL';
  rows.push(row); writeFileSync(join(raw, 'receipts.json'), JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify({ id, outcome: row.outcome, status: row.status, elapsedMs: Math.round(row.elapsedMs), killed }));
  return row;
}
const flags = ['--permission', '--allow-fs-read=' + state.consumer, '--import', join(harness, 'audit-loader.mjs')];
const run = (id, testId = id, extra = [], options = {}) => supervised(id, [...flags, join(harness, options.consumer ?? 'consumer.mjs'), testId, ...extra], options);
if (phase === 'frozen') {
  for (const test of cases) await run(test.id, test.id, [], { deadlineMs: test.deadlineMs });
  const protocols = JSON.parse(readFileSync(join(own, 'frozen-protocols.json')));
  for (const test of protocols.filter(test => test.id.startsWith('P') || test.id === 'N02-poisoned-source')) await run(test.id);
} else if (phase === 'corrections-v2') {
  for (const id of ['L02-heading-paragraph', 'L06-raw-ordinary-text', 'U-title-alt-injection', 'B10-files', 'B11-args', 'P11-shell-middleware']) await run(id + '-v2', id + '-v2', [], { consumer: 'supplemental-consumer.mjs' });
} else if (phase === 'supplemental-protocols') {
  for (const id of ['shared-counters', 'primary-cleanup-error', 'vfs-stream-signal-and-boundary', 'literal-file-cli-and-no-host']) await run(id, id, [], { consumer: 'supplemental-consumer.mjs' });
  await supervised('poison-sentinel-live', [state.poisonedSource], { expectedStatus: 1, expectedError: 'POISONED_RETIRED_SOURCE_MUST_NOT_LOAD' });
  await supervised('unexported-leaf-control', ['--input-type=module', '-e', "await import('virtual-bash/commands/html-to-markdown')"], { expectedStatus: 1, expectedError: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
} else if (phase === 'abort-and-supervisor') {
  const control = await supervised('supervisor-busy-loop', ['-e', 'while(true){}'], { deadlineMs: 150 });
  assert(control.killed && control.signal === 'SIGKILL' && control.processGroupGone);
  control.outcome = 'PASS'; control.expectedTimeout = true;
  await run('abort-during-trim', 'abort-during-trim', [], { consumer: 'supplemental-consumer.mjs' });
} else if (phase === 'comparative') {
  const baseline = JSON.parse(readFileSync(join(capture, 'author-pandoc.json')));
  const native = baseline.native.path;
  assert.equal(hash(readFileSync(native)), baseline.native.sha256);
  await supervised('pandoc-version', ['--version'], { executable: native });
  for (const test of baseline.rows) {
    const filename = join(harness, test.name + '.json'); writeFileSync(filename, JSON.stringify({ input: test.html, expected: test.ours.stdout, status: test.ours.status }));
    await run('module-' + test.name, 'custom', [filename]);
    const row = await supervised('pandoc-' + test.name, baseline.native.args, { executable: native, input: test.html });
    assert.equal(readFileSync(join(raw, row.id + '.stdout'), 'utf8'), test.reference.stdout);
    assert.equal(readFileSync(join(raw, row.id + '.stderr'), 'utf8'), test.reference.stderr);
  }
  const semantic = JSON.parse(readFileSync(join(capture, 'followup-semantic/receipts.json')));
  for (const test of semantic.filter(test => test.result?.actual?.stdout)) {
    await supervised('parse-' + test.id, ['--sandbox', '--from=commonmark_x', '--to=json'], { executable: native, input: test.result.actual.stdout });
  }
  const corrected = JSON.parse(readFileSync(join(capture, 'corrections-v2/receipts.json'))).find(test => test.id === 'U-title-alt-injection-v2');
  await supervised('parse-title-alt', ['--sandbox', '--from=commonmark_x', '--to=json'], { executable: native, input: corrected.result.actual.stdout });
} else if (phase === 'controls') {
  const leaf = join(state.installed, 'dist/commands/html-to-markdown/index.js');
  renameSync(leaf, leaf + '.held');
  try { await run('N01-missing-entry', 'L01-empty', [], { expectedStatus: 1, expectedError: 'ERR_MODULE_NOT_FOUND' }); } finally { renameSync(leaf + '.held', leaf); }
  const dependency = join(state.installed, 'dist/commands/html-to-markdown/parser.js');
  renameSync(dependency, dependency + '.held');
  try { await run('N03-layout', 'L01-empty', [], { expectedStatus: 1, expectedError: 'ERR_MODULE_NOT_FOUND' }); } finally { renameSync(dependency + '.held', dependency); }
  for (const id of ['N05-wrong-literal', 'N05-tiny-budget']) await run(id, id, [], { expectedStatus: 1, expectedError: 'AssertionError' });
  await run('N02-poisoned-source');
  await supervised('N02-direct-denial', ['--permission', '--allow-fs-read=' + state.consumer, '--input-type=module', '-e', `import {readFileSync} from 'node:fs';readFileSync(${JSON.stringify(state.poisonedSource)})`], { expectedStatus: 1, expectedError: 'ERR_ACCESS_DENIED' });
  const prefix = `import { createHtmlToMarkdownCommand, htmlToMarkdownCommands, type HtmlToMarkdownLimits } from '../node_modules/virtual-bash/dist/commands/html-to-markdown/index.js';\n`;
  const positive = prefix + `const limits: Partial<HtmlToMarkdownLimits> = {maxWorkUnits: 4096}; createHtmlToMarkdownCommand({limits}); htmlToMarkdownCommands({replace: true});\n`;
  for (const [id, text, expectedStatus] of [['positive', positive, 0], ['unknown-limit', prefix + 'createHtmlToMarkdownCommand({limits:{imaginary: 3}});', 2], ['wrong-limit', prefix + 'createHtmlToMarkdownCommand({limits:{maxInputBytes: "4"}});', 2], ['wrong-replace', prefix + 'htmlToMarkdownCommands({replace: 1});', 2]]) {
    const input = join(harness, id + '.mts'); writeFileSync(input, text); copyFileSync(input, join(raw, id + '.mts.fixture'));
    await supervised('N04-' + id, [join(state.tools, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2023', '--typeRoots', join(state.tools, 'node_modules/@types'), input], { deadlineMs: 10000, expectedStatus, expectedError: expectedStatus ? 'TS(?:2353|2322)' : undefined });
  }
} else if (phase === 'stress') {
  for (const form of [...stressForms, 'trim-internal-space', 'unresolved-entity-regex']) for (const size of stressScales) {
    let input;
    if (form === 'unterminated-quoted-attribute') input = '<a title="' + 'x'.repeat(size);
    if (form === 'repeated-less-than') input = '<'.repeat(size);
    if (form === 'rawtext-close-near-miss') input = '<script>' + '</scripX>'.repeat(Math.ceil(size / 9));
    if (form === 'long-entity') input = '&' + 'x'.repeat(size) + ';';
    if (form === 'alternating-backticks') input = '<pre>' + '` '.repeat(size / 2) + '</pre>';
    if (form === 'trim-internal-space') input = '<pre>x' + ' '.repeat(size) + 'x</pre>';
    if (form === 'unresolved-entity-regex') input = '<a href="' + '&#'.repeat(size / 2) + '">label</a>';
    const filename = join(harness, form + '-' + size + '.json'); writeFileSync(filename, JSON.stringify({ input, limits: { maxTokenBytes: 1048576, maxTokens: 1000000, maxNodes: 1000000 } }));
    const row = await run(form + '-' + size, 'custom', [filename], { deadlineMs: 5000 }); row.form = form; row.size = size;
  }
} else if (phase.startsWith('followup')) {
  const tests = JSON.parse(readFileSync(join(own, phase + '.json')));
  for (const test of tests) {
    const filename = join(harness, test.id + '.json'); writeFileSync(filename, JSON.stringify(test)); await run(test.id, 'custom', [filename], { deadlineMs: test.deadlineMs ?? 5000, consumer: 'supplemental-consumer.mjs' });
  }
} else throw new Error('unknown phase');
assert.deepEqual(inventory(state.installed), state.installedBefore, 'installed tree changed (including new entries)');
writeFileSync(join(raw, 'receipts.json'), JSON.stringify(rows, null, 2) + '\n');
writeFileSync(join(raw, 'summary.json'), JSON.stringify({ startedFromFreeze: state.freeze, finished: new Date().toISOString(), total: rows.length, pass: rows.filter(row => row.outcome === 'PASS').length, fail: rows.filter(row => row.outcome === 'FAIL').length, installedUnchangedIncludingNewEntries: true, harnessHashes: inventory(harness), rows: rows.map(({ id, outcome }) => ({ id, outcome })) }, null, 2) + '\n');
