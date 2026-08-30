import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [snapshot, output, evidence] = process.argv.slice(2);
const dist = realpathSync(join(snapshot, 'dist'));
const hashes = JSON.parse(readFileSync(join(output, 'dist-hashes.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const imports = [];
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    if (!resolved.url.startsWith('node:')) {
      assert.ok(resolved.url.startsWith('file:'), 'non-file product import blocked');
      const path = realpathSync(fileURLToPath(resolved.url));
      assert.ok(path.startsWith(dist + '/'), 'outside frozen dist import blocked: ' + path);
      assert.equal(path, fileURLToPath(resolved.url), 'symlink import blocked');
    }
    return resolved;
  },
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith('node:')) {
      const path = fileURLToPath(url);
      const name = relative(dist, path);
      const digest = hash(readFileSync(path));
      assert.equal(digest, hashes[name], 'changed compiled module blocked: ' + name);
      assert.equal(hash(Buffer.from(result.source)), digest, 'loaded source mismatch');
      imports.push({ name, sha256: digest });
    }
    return result;
  },
});
let blocked = false;
try { await import(pathToFileURL(join(evidence, 'cases.mjs')).href); }
catch (error) { blocked = /outside frozen dist import blocked/.test(error.message); }
assert.equal(blocked, true);
const api = await import(pathToFileURL(join(dist, 'index.js')).href);
const leaf = await import(pathToFileURL(join(dist, 'commands/time-env/index.js')).href);
const cases = JSON.parse(readFileSync(join(evidence, 'cases.frozen.json')));
const native = new Map(readFileSync(join(evidence, 'native-results.jsonl'), 'utf8').trim().split('\n').map(line => {
  const row = JSON.parse(line); return [row.id, row];
}));
const defaults = api.createAgentCommands();
assert.equal(defaults.length, 65);
assert.equal(defaults.some(command => command.name === 'date'), false);
assert.equal(api.timeEnvCommands, undefined);
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const hex = text => Buffer.from(text).toString('hex');
const rows = [];
const environmentBefore = { ...process.env };
for (const row of cases.product) {
  let samples = 0;
  let stdoutWrites = 0;
  let middlewareCalls = 0;
  let intercepted;
  const shell = new api.Shell({ fs: new api.MemoryFileSystem(), env: { TZ: row.zone, LC_ALL: 'C' } });
  shell.use(leaf.timeEnvCommands({ clock: () => row.clock + samples++ * 1000, limits: row.limits }));
  shell.use(async (context, next) => {
    middlewareCalls++;
    intercepted = [...context.args];
    const sink = context.stdout;
    context.stdout = { async write(bytes) { stdoutWrites++; await sink.write(bytes); } };
    return await next();
  });
  const script = ['date', ...row.args].map(quote).join(' ');
  const started = performance.now();
  let actual;
  try {
    const result = await shell.exec(script, { signal: AbortSignal.timeout(2000) });
    actual = { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString('hex'), stderrHex: Buffer.from(result.stderrBytes).toString('hex'), error: null };
  } catch (error) {
    actual = { status: null, stdoutHex: '', stderrHex: '', error: { name: error.name, code: error.code ?? null, message: error.message } };
  } finally { await shell.dispose(); }
  const expectedNative = native.get(row.id);
  const strictNativeMatch = expectedNative === undefined ? null : actual.status === expectedNative.status
    && actual.stdoutHex === expectedNative.stdoutHex && actual.stderrHex === expectedNative.stderrHex && !actual.error;
  const expected = row.expectedError ? { errorCode: 'EFBIG', message: row.expectedError } : row.expectedText !== undefined
    ? { status: row.expectedStatus ?? 0, stdoutHex: hex(row.expectedText), stderrHex: hex(row.expectedStderr ?? '') }
    : expectedNative ? { status: expectedNative.status, stdoutHex: expectedNative.stdoutHex, stderrHex: expectedNative.stderrHex } : null;
  const valueMatch = row.expectedError ? actual.error?.code === 'EFBIG' && actual.error.message === row.expectedError && stdoutWrites === 0
    : expected && actual.status === expected.status && actual.stdoutHex === expected.stdoutHex && actual.stderrHex === expected.stderrHex && !actual.error;
  const invocationMatch = JSON.stringify(intercepted) === JSON.stringify(row.args) && middlewareCalls === 1;
  const sampleMatch = samples === row.expectedSamples;
  const record = { id: row.id, category: row.category, script, args: row.args, env: { LC_ALL: 'C', TZ: row.zone },
    clock: row.clock, expectedSamples: row.expectedSamples, samples, sampleMatch, intercepted, middlewareCalls, invocationMatch,
    stdoutWrites, expected, actual, strictNativeMatch, valueMatch, pass: !!valueMatch && sampleMatch && invocationMatch, milliseconds: performance.now() - started };
  rows.push(record);
  appendFileSync(join(output, 'product-results.jsonl'), JSON.stringify(record) + '\n');
  if (!record.pass) console.log(JSON.stringify(record));
}
assert.deepEqual(process.env, environmentBefore);
writeFileSync(join(output, 'imports.json'), JSON.stringify(imports, null, 2) + '\n');
const summary = { identity: cases.identity, node: process.version, versions: process.versions, commit: cases.commit,
  defaultCommandCount: defaults.length, dateDefault: false, publicTimeEnvExport: false,
  entry: 'Compiled pinned src/index.ts root API + src/commands/time-env/index.ts leaf source entry; no private formatter imports; not a package-export claim.',
  importGuardNegativeControl: blocked, importedModules: imports.length, environmentUnchanged: true,
  total: rows.length, passes: rows.filter(row => row.pass).length, failures: rows.filter(row => !row.pass).map(row => row.id),
  strictNativeTotal: rows.filter(row => row.strictNativeMatch !== null).length, strictNativeMatches: rows.filter(row => row.strictNativeMatch === true).length,
  categories: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => {
    const group = rows.filter(row => row.category === category);
    return [category, { total: group.length, passes: group.filter(row => row.pass).length,
      strictNativeTotal: group.filter(row => row.strictNativeMatch !== null).length, strictNativeMatches: group.filter(row => row.strictNativeMatch === true).length }];
  })) };
writeFileSync(join(output, 'product-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
process.exitCode = summary.failures.length ? 1 : 0;
