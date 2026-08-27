import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../../..');
const evidenceCommit = 'd98b8321', candidate = '8670ebe8f0d39966c2de2638780437398e5f8490';
const prefix = 'tests/integration/full-gate-20260827/combined-8670ebe8';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/loader-null-independent-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const capture = JSON.parse(git(['show', `${evidenceCommit}:${prefix}/attempt-v4/CAPTURE.json`]));
const raw = Buffer.from(git(['show', `${evidenceCommit}:${prefix}/attempt-v4/raw-capture.tar.gz.b64`]).toString(), 'base64');
assert.equal(hash(raw), capture.files.find(entry => entry.name === 'raw-capture.tar.gz.b64').originalSha256);
const original = JSON.parse(execFileSync('/usr/bin/tar', ['-xOf', '-', './report.json'], { input: raw, maxBuffer: 64 * 1024 * 1024, timeout: 30000 }));
const originalLog = execFileSync('/usr/bin/tar', ['-xOf', '-', './test.stdout.log'], { input: raw, maxBuffer: 16 * 1024 * 1024, timeout: 30000 }).toString();
const summary = JSON.parse(git(['show', `${evidenceCommit}:${prefix}/attempt-v4/SUMMARY.json`]));
const files = summary.failures.filter(entry => entry.group === 'loader-file-startup').map(entry => entry.canonicalPath); assert.equal(files.length, 4);
const report = { startedAt: new Date().toISOString(), candidate, evidenceCommit: git(['rev-parse', evidenceCommit]).toString().trim(), originalNode: original.node, originalEnvironment: original.environment, originalPhase: { executable: 'npm', args: ['test', '--', '--test-concurrency=2'] }, originalFailures: summary.failures.filter(entry => entry.group === 'loader-file-startup'), executions: [], source: {}, tools: {}, privateAccess: false, wholeGateLaunched: false, builds: 0 };
assert.equal(process.version, original.node.version); assert.equal(hash(readFileSync(process.execPath)), original.node.sha256);
const source = join(temporary, 'source'), harness = join(temporary, 'harness'); mkdirSync(source); mkdirSync(harness);
const tar = join(temporary, 'selected-source.tar');
git(['archive', '-o', tar, candidate, 'src', 'tests/commands/metadata-stress', 'tests/commands/safejs', 'tests/integrations/safejs', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']);
execFileSync('/usr/bin/tar', ['-xf', tar, '-C', source], { timeout: 60000 });
const rows = git(['ls-tree', '-rz', candidate, 'src', 'tests/commands/metadata-stress', 'tests/commands/safejs', 'tests/integrations/safejs', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString().split('\0').filter(Boolean);
for (const row of rows) { const separator = row.indexOf('\t'), [mode, , blob] = row.slice(0, separator).split(' '), path = row.slice(separator + 1); assert.ok(mode === '100644' || mode === '100755'); const bytes = readFileSync(join(source, path)); assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob); report.source[path] = hash(bytes); }
for (const [path, pin] of Object.entries(original.dependencies.root.files)) {
  const origin = join(repository, 'node_modules', path), bytes = readFileSync(origin); assert.equal(hash(bytes), pin.sha256, `Frozen tool drift: ${path}`);
  const destination = join(source, 'node_modules', path); write(destination, bytes); chmodSync(destination, pin.mode); assert.equal(lstatSync(destination).nlink, 1); report.tools[path] = pin;
}
const guard = join(harness, 'import-guard.mjs'), guardBytes = git(['show', `${evidenceCommit}:${prefix}/import-guard.mjs`]);
assert.equal(hash(guardBytes), original.successorHarnessHashes['import-guard.mjs']); write(guard, guardBytes);
const critical = Object.fromEntries(['src/commands/execution.ts', 'src/commands/env-split.ts'].map(path => [path, report.source[path]])); write(join(harness, 'critical-source.json'), JSON.stringify(critical));
const expectedCleanup = git(['show', `${evidenceCommit}:${prefix}/cleanup-expected.json`]); write(join(harness, 'cleanup-expected.json'), expectedCleanup);
const env = Object.fromEntries(Object.entries(original.environment).map(([name, value]) => [name, value.replaceAll(original.temporary, temporary)]));
delete env.NODE_TEST_CONTEXT;
env.NODE_OPTIONS = '--import=' + pathToFileURL(guard).href;
for (const path of ['home', 'tmp', 'native-bin']) mkdirSync(join(temporary, path));
write(join(source, 'tests/commands/metadata-stress/permission-profile-independent/fixture-original.ts'), git(['show', '3a1025f53e502c3426ffee34eb8d8037b27c26f8:tests/commands/metadata-stress/permission-profile/fixtures.ts']));
env.METADATA_HELPER_COPY = join(source, 'tests/commands/metadata-stress/permission-profile-independent/fixture-original.ts');
const execute = (label, args, overrides = {}, executable = process.execPath) => {
  const imports = join(output, `${label}.imports`), trace = join(output, `${label}.trace.ndjson`);
  const actualEnv = { ...env, FULL_GATE_IMPORTS: imports, TRACE_FILE: trace, ...overrides };
  const child = spawnSync(executable, args, { cwd: source, env: actualEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  write(join(output, `${label}.stdout.log`), child.stdout ?? ''); write(join(output, `${label}.stderr.log`), child.stderr ?? '');
  const entry = { label, executable, args, status: child.status, signal: child.signal, error: child.error?.message ?? null, stdoutSha256: hash(child.stdout ?? ''), stderrSha256: hash(child.stderr ?? ''), hasNullSourceFailure: /ERR_INVALID_RETURN_PROPERTY_VALUE[\s\S]*got null/.test(child.stderr ?? '') || /ERR_INVALID_RETURN_PROPERTY_VALUE[\s\S]*got null/.test(child.stdout ?? ''), environmentDelta: overrides, trace: existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] };
  report.executions.push(entry); console.log(JSON.stringify({ label, status: entry.status, nullSource: entry.hasNullSourceFailure }));
  assert.equal(child.error, undefined); assert.equal(child.signal, null); return entry;
};
try {
  const snippets = originalLog.split('\n').flatMap((line, index, lines) => line.includes('# node:internal/modules/customization_hooks:280') ? [{ line: index + 1, text: lines.slice(index, index + 34).join('\n') }] : []);
  assert.equal(snippets.length, 4); write(join(output, 'ORIGINAL-FOUR.json'), JSON.stringify(snippets, null, 2) + '\n');
  for (const [index, file] of files.entries()) {
    const entry = execute(`serial-${index + 1}`, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-name-pattern=^LOADER_REVIEW_NO_TEST_BODY$', file]);
    assert.equal(entry.status, 1); assert.equal(entry.hasNullSourceFailure, true);
  }
  const together = execute('concurrency-two', ['--import', 'tsx', '--test', '--test-concurrency=2', '--test-name-pattern=^LOADER_REVIEW_NO_TEST_BODY$', ...files]); assert.equal(together.status, 1); assert.equal(together.hasNullSourceFailure, true);
  const main = join(source, 'loader-repro.mjs'); write(main, "import ts from 'typescript';console.log('typescript-loaded:'+ts.version);\n");
  const traceLoader = join(harness, 'trace-loader.mjs');
  write(traceLoader, `import {appendFileSync} from 'node:fs';export async function load(url,context,next){const result=await next(url,context);if(url.includes('/typescript/')||url.endsWith('/plain.cjs')||url.startsWith('file:')&&result.source==null)appendFileSync(process.env.TRACE_FILE,JSON.stringify({stage:'after-downstream-async',url,contextFormat:context.format,format:result.format,source:result.source===null?'null':result.source===undefined?'undefined':typeof result.source,bytes:result.source?.byteLength??result.source?.length,shortCircuit:result.shortCircuit})+'\\n');return result;}\n`);
  const register = join(harness, 'register-trace.mjs'); write(register, `import {register} from 'node:module';register(${JSON.stringify(pathToFileURL(traceLoader).href)},import.meta.url);\n`);
  const traced = execute('minimal-typescript-traced', ['--import', 'tsx', '--import', register, main]); assert.equal(traced.hasNullSourceFailure, true);
  assert.ok(traced.trace.some(entry => entry.format === 'commonjs' && entry.source === 'null'));
  const noGuard = execute('diagnostic-no-guard', ['--import', 'tsx', main], { NODE_OPTIONS: '' }); assert.equal(noGuard.status, 0);
  const noTsx = execute('diagnostic-no-tsx', [main]); assert.equal(noTsx.status, 0);
  write(join(source, 'plain.cjs'), "module.exports = {value:'plain-commonjs'};\n");
  write(join(source, 'plain-repro.mjs'), "import value from './plain.cjs';console.log(value.value);\n");
  const plain = execute('plain-commonjs-no-tsx', ['--import', register, join(source, 'plain-repro.mjs')]);
  assert.equal(plain.status, 1); assert.match(readFileSync(join(output, 'plain-commonjs-no-tsx.stderr.log'), 'utf8'), /ERR_INVALID_RETURN_PROPERTY_VALUE[\s\S]*got undefined/u);
  assert.ok(plain.trace.some(entry => entry.format === 'commonjs' && entry.source === 'undefined'));
  const lower = execute('trace-before-tsx', ['--import', register, '--import', 'tsx', main]); assert.equal(lower.hasNullSourceFailure, true);
  assert.ok(lower.trace.some(entry => entry.format === 'commonjs' && ['null', 'undefined'].includes(entry.source)));
  for (const [index, file] of files.entries()) {
    const entry = execute(`traced-entry-${index + 1}`, ['--import', 'tsx', '--import', register, '--test', '--test-concurrency=1', '--test-name-pattern=^LOADER_REVIEW_NO_TEST_BODY$', file]);
    assert.equal(entry.status, 1); assert.equal(entry.hasNullSourceFailure, true);
    assert.ok(entry.trace.some(row => row.url.endsWith('/typescript/lib/typescript.js') && row.format === 'commonjs' && row.source === 'null'));
  }
  const alternateNode = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
  assert.equal(existsSync(alternateNode), true);
  report.alternateNode = { executable: alternateNode, sha256: hash(readFileSync(alternateNode)), version: execFileSync(alternateNode, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(), status: 'separate available-runtime diagnostic, not a selected successor gate profile' };
  for (const [index, file] of files.entries()) {
    const entry = execute(`node24-entry-${index + 1}`, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-name-pattern=^LOADER_REVIEW_NO_TEST_BODY$', file], {}, alternateNode);
    assert.equal(entry.status, 0); assert.equal(entry.hasNullSourceFailure, false);
  }
  const alternatePlain = execute('node24-plain-commonjs', ['--import', register, join(source, 'plain-repro.mjs')], {}, alternateNode); assert.equal(alternatePlain.status, 0);
  for (const [name, sourceText] of Object.entries(process.binding('natives'))) if (['internal/modules/customization_hooks', 'internal/modules/esm/loader', 'internal/modules/esm/load'].includes(name)) {
    const namePart = name.split('/').at(-1); write(join(output, `node22-${namePart}.js.txt`), sourceText); report[name] = { sha256: hash(sourceText), runtime: process.version };
  }
  report.guardSha256 = hash(guardBytes); report.toolCount = Object.keys(report.tools).length;
  report.bootstrapQualification = 'Unchanged four candidate entry files and original Node/tsx/TypeScript/import-guard. Test-name pattern prevents test bodies or private engine calls; this measures bootstrap only, not skipped workflow acceptance. METADATA_HELPER_COPY is a byte-exact historical fixture outside the selected inputs to avoid live Git source fallback after successful bootstrap.';
  report.conclusions = { serial: '4/4 reproduce identical null-source bootstrap failure', concurrency: 'all four files also fail at concurrency2', failingModule: traced.trace, plainCommonJsWithoutTsx: 'same validation boundary rejects undefined; exact distinction retained, not called null', traceBeforeTsx: lower.trace, alternateNode: '4/4 bootstrap success plus plain CommonJS success on installed24.11.1; test bodies intentionally filtered, not feature acceptance', productFixIndicated: false };
  for (const [path, expected] of Object.entries(report.source)) assert.equal(hash(readFileSync(join(source, path))), expected, path);
  for (const [path, pin] of Object.entries(report.tools)) assert.equal(hash(readFileSync(join(source, 'node_modules', path))), pin.sha256);
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString(); write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n'); }
