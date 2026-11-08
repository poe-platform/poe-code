import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';

const repo = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const report = dirname(fileURLToPath(import.meta.url));
const prior = 'benchmarks/reports/sort-performance-next-20260827/';
const baseline = '08a26051438f5c6bdde100a4fe724dbb84f6fca4';
const candidate = 'b4fe4c7868b7ab7067599c6f5d10e99d143aea54';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: 'wx' }); };
const json = (path, value) => put(path, JSON.stringify(value, null, 2) + '\n');
const output = resolve(process.argv[2] ?? '');
assert.ok(process.argv.includes('--capture'), 'Explicit capture only; use a fresh owned output directory');
assert.ok(output.startsWith(report + '/attempt-'));
assert.ok(!existsSync(output));
mkdirSync(output);
const scratch = mkdtempSync('/tmp/sort-key-author-capture-');
const tools = {
  node: process.version, nodePath: process.execPath, nodeSha256: hash(readFileSync(process.execPath)),
  typescript: JSON.parse(readFileSync(join(repo, 'node_modules/typescript/package.json'))).version,
  typescriptSha256: hash(readFileSync(join(repo, 'node_modules/typescript/lib/typescript.js'))),
  tscSha256: hash(readFileSync(join(repo, 'node_modules/typescript/lib/_tsc.js'))),
  tsxSha256: hash(readFileSync(join(repo, 'node_modules/tsx/dist/loader.mjs'))),
  platform: process.platform, arch: process.arch,
};
const commands = [];
function command(label, executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, timeout: 90000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } });
  put(join(output, label + '.stdout'), result.stdout ?? '');
  put(join(output, label + '.stderr'), result.stderr ?? '');
  commands.push({ label, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, childClosed: true });
  assert.equal(result.status, 0, label + ': ' + result.stderr);
  return result.stdout;
}
function inventory(root) {
  const files = {};
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[path] = { sha256: hash(readFileSync(join(root, path))), bytes: readFileSync(join(root, path)).length };
    }
  }
  visit(''); return files;
}
const frozen = git('show', '68f03711:' + prior + 'workloads.json');
assert.equal(hash(frozen), '3d99fdebe7262d3fcce473e96af7ddbe6bb27b1fe17886657cddc8d32e8c0504');
put(join(scratch, 'workloads.json'), frozen);
const manifest = JSON.parse(git('show', '68f03711:' + prior + 'MANIFEST.json'));
for (const [path, identity] of Object.entries(manifest.files)) assert.equal(hash(git('show', '68f03711:' + prior + path)), identity.sha256);
const originalWorker = git('show', '68f03711:' + prior + 'worker.mjs').toString();
let worker = originalWorker.replace("variant === 'instrumented'", "variant.endsWith('instrumented')");
assert.notEqual(worker, originalWorker);
put(join(output, 'worker.mjs'), worker);
const freeze = { baseline, candidate, committedProductDeltas: git('diff', '--name-status', baseline, candidate, '--', 'src', 'package.json', 'tsconfig.build.json').toString(), sourceCommitPaths: git('diff-tree', '--no-commit-id', '--name-only', '-r', candidate).toString(), tools, loadBefore: loadavg(), workloadSha256: hash(frozen), authenticatedPriorEntries: Object.keys(manifest.files).length, workerOriginalSha256: hash(originalWorker), workerSha256: hash(worker), captureSha256: hash(readFileSync(fileURLToPath(import.meta.url))), selected: {}, instrumentation: [] };
let successful = false;
const before = {};
try {
  for (const [variant, commit] of [['baseline', baseline], ['candidate', candidate]]) {
    const root = join(scratch, variant); mkdirSync(root);
    const archivePaths = ['src', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/core-sort', 'tests/commands/helpers.ts', 'tests/contracts/io.test.ts'];
    const archive = git('archive', '--format=tar', commit, ...archivePaths);
    const archivePath = join(scratch, variant + '.tar'); put(archivePath, archive);
    command(variant + '-extract', '/usr/bin/tar', ['-xf', archivePath, '-C', root], repo);
    freeze.selected[variant] = { commit, tree: git('rev-parse', commit + '^{tree}').toString().trim(), archiveSha256: hash(archive), inputs: inventory(root) };
    symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
    command(variant + '-build', process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], root);
    if (variant === 'candidate') {
      command('candidate-types', process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'], root);
      const tests = ['tests/commands/core-sort/single-numeric-key-cache.test.ts', 'tests/commands/core-sort/regressions.test.ts', 'tests/commands/core-sort/borrowed-buffer.test.ts', 'tests/commands/core-sort/unkeyed-numeric-cache.test.ts', 'tests/contracts/io.test.ts'];
      command('candidate-tests', process.execPath, ['--import', 'tsx', '--test', ...tests], root);
      command('candidate-pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], root);
      const tarball = join(scratch, 'virtual-bash-0.0.0.tgz');
      const moved = join(scratch, 'moved'); mkdirSync(moved);
      command('candidate-unpack', '/usr/bin/tar', ['-xzf', tarball, '-C', moved], repo);
      renameSync(tarball, join(output, 'candidate-package.tgz'));
      renameSync(join(moved, 'package'), join(scratch, 'moved-candidate'));
      freeze.package = { sha256: hash(readFileSync(join(output, 'candidate-package.tgz'))), files: inventory(join(scratch, 'moved-candidate')) };
    }
    const instrumented = join(scratch, variant + '-instrumented'); cpSync(root, instrumented, { recursive: true, verbatimSymlinks: true });
    for (const path of ['src/commands/text.ts', 'src/commands/internal.ts']) {
      let text = readFileSync(join(instrumented, path), 'utf8');
      const edits = [];
      const replace = (old, next) => { assert.equal(text.split(old).length - 1, 1, variant + ' ' + old); text = text.replace(old, next); edits.push({ old, next }); };
      if (path.endsWith('/text.ts')) {
        replace('function compareBytes', 'const profile = () => (globalThis as any).__sortProfile;\nfunction compareBytes');
        replace('return Buffer.compare(left, right);', 'profile()?.count("byteCompare"); return Buffer.compare(left, right);');
        replace('return { whole, fraction, negative:', 'profile()?.numeric(bytes, whole, fraction); return { whole, fraction, negative:');
        replace('const firstFraction = first.fraction.padEnd(width, "0");', 'profile()?.count("fractionPadEndCalls", 2); profile()?.count("fractionPaddedLogicalCharacters", width * 2); const firstFraction = first.fraction.padEnd(width, "0");');
        replace('return line.subarray(Math.min(start, line.length), Math.max(start, end));', 'const selected = line.subarray(Math.min(start, line.length), Math.max(start, end)); profile()?.key(line, selected, fields.length); return selected;');
        replace('    let start = 0;\n    for (let offset = 0; offset < chunk.length; offset++) {', '    profile()?.count("collectorChunks"); profile()?.count("collectorScannedBytes", chunk.length);\n    let start = 0;\n    for (let offset = 0; offset < chunk.length; offset++) {');
        replace('else accept(new Uint8Array(part));', 'else { profile()?.count("collectorDirectCopyBytes", part.length); accept(new Uint8Array(part)); }');
        replace('pending.push(new Uint8Array(chunk.subarray(start)));', 'profile()?.count("collectorTailCopyBytes", chunk.length - start); pending.push(new Uint8Array(chunk.subarray(start)));');
        replace('if (pending.length) { pending.push(part); accept(concatenate(pending, size)); }', 'if (pending.length) { profile()?.count("collectorConcatCopyBytes", size); pending.push(part); accept(concatenate(pending, size)); }');
        replace('if (size) accept(concatenate(pending, size));', 'if (size) { profile()?.count("collectorConcatCopyBytes", size); accept(concatenate(pending, size)); }');
        replace('compareBytes(left, right) * direction : (left: Uint8Array, right: Uint8Array) => {', '(profile()?.count("keyCompare"), compareBytes(left, right) * direction) : (left: Uint8Array, right: Uint8Array) => {\n        profile()?.count("keyCompare");');
        replace('records.sort(compare);', 'profile()?.phase("sort"); records.sort(compare); profile()?.phase("emit");');
        {
          replace('function compareNumericValues(first: NumericValue, second: NumericValue): number {', 'function compareNumericValues(first: NumericValue, second: NumericValue): number { profile()?.count("numericCompare");');
          replace('const numericValues = new Map<Uint8Array, NumericValue>();', 'profile()?.count("cacheCreated"); const numericValues = new Map<Uint8Array, NumericValue>();');
          replace('const cached = numericValues.get(bytes);\n          if (cached !== undefined) return cached;', 'const cached = numericValues.get(bytes);\n          if (cached !== undefined) { profile()?.count("cacheHits"); return cached; }');
          replace('if (numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes) return parseNumeric(bytes);', 'if (numericValues.size >= 16_384 || charge > 1_048_576 - retainedBytes) { profile()?.count("cacheFallbacks"); return parseNumeric(bytes); }');
          replace('retainedBytes += charge;', 'retainedBytes += charge; profile()?.count("cacheEntries"); profile()?.count("cacheRetainedBytes", charge);');
        }
        if (variant === 'candidate') {
          replace('keyCompare = (left, right) => {', 'keyCompare = (left, right) => { profile()?.count("keyCompare");');
          replace('const keyedNumericValues = new Map<Uint8Array, NumericValue>();', 'profile()?.count("keyedCacheCreated"); const keyedNumericValues = new Map<Uint8Array, NumericValue>();');
          replace('const cached = keyedNumericValues.get(record);\n          if (cached !== undefined) return cached;', 'const cached = keyedNumericValues.get(record);\n          if (cached !== undefined) { profile()?.count("keyedCacheHits"); return cached; }');
          replace('if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes) return parseNumeric(bytes);', 'if (keyedNumericValues.size >= 16_384 || charge > 1_048_576 - retainedKeyBytes) { profile()?.count("keyedCacheFallbacks"); return parseNumeric(bytes); }');
          replace('retainedKeyBytes += charge;', 'retainedKeyBytes += charge; profile()?.count("keyedCacheEntries"); profile()?.count("keyedCacheRetainedBytes", charge);');
        }
      } else {
        replace('export async function output(context: CommandContext, text: string | Uint8Array): Promise<void> {', 'export async function output(context: CommandContext, text: string | Uint8Array): Promise<void> {\n  (globalThis as any).__sortProfile?.count("outputCalls." + context.command);');
      }
      writeFileSync(join(instrumented, path), text);
      put(join(output, variant + '-' + path.split('/').at(-1) + '.txt'), text);
      freeze.instrumentation.push({ variant, path, edits, sha256: hash(text) });
    }
    command(variant + '-instrumented-build', process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], instrumented);
  }
  for (const variant of ['baseline', 'candidate', 'moved-candidate', 'baseline-instrumented', 'candidate-instrumented']) before[variant] = inventory(join(scratch, variant));
  freeze.loadedTrees = before;
  json(join(output, 'freeze.json'), freeze);
  const results = {};
  for (const variant of Object.keys(before)) {
    const stdout = command(variant + '-frozen21', '/bin/sh', ['-c', 'ulimit -t 60; exec "$1" --max-old-space-size=512 "$2" "$3" "$4"', 'author-sort', process.execPath, join(output, 'worker.mjs'), scratch, variant], repo);
    const result = JSON.parse(stdout); json(join(output, variant + '.json'), result); results[variant] = result;
    assert.equal(result.rows.length, 21); assert.ok(result.rows.every(row => row.equivalent), variant);
    assert.deepEqual(result.rows.map(row => row.observationHash), results.baseline.rows.map(row => row.observationHash));
  }
  for (let index = 0; index < 21; index++) {
    const old = results['baseline-instrumented'].rows[index].profile.counts;
    const next = results['candidate-instrumented'].rows[index].profile.counts;
    for (const key of Object.keys(old).filter(key => /^(collector|outputCalls|byteCompare|keyCompare|numericCompare|fraction)/.test(key))) assert.equal(next[key], old[key], `${index} ${key}`);
  }
  const numeric = results['candidate-instrumented'].rows.find(row => row.id === 'numeric-stable-8000').profile.counts;
  assert.equal(numeric.numericParses, 8000); assert.equal(numeric.cacheEntries, 8000); assert.ok(numeric.cacheRetainedBytes <= 1_048_576);
  const keyed = results['candidate-instrumented'].rows.find(row => row.id === 'numeric-key-8000').profile.counts;
  const oldKeyed = results['baseline-instrumented'].rows.find(row => row.id === 'numeric-key-8000').profile.counts;
  assert.equal(oldKeyed.numericParses, 164900); assert.equal(oldKeyed.keyExtractions, 164900); assert.equal(oldKeyed.keyFieldObjects, 494700);
  assert.equal(keyed.numericParses, 8000); assert.equal(keyed.keyExtractions, 8000); assert.equal(keyed.keyFieldObjects, 24000);
  assert.equal(keyed.keyedCacheEntries, 8000); assert.ok(keyed.keyedCacheRetainedBytes <= 1048576);
  assert.deepEqual(numeric, results['baseline-instrumented'].rows.find(row => row.id === 'numeric-stable-8000').profile.counts);
  assert.equal(hash(readFileSync(join(scratch, 'baseline/dist/commands/text.d.ts'))), hash(readFileSync(join(scratch, 'candidate/dist/commands/text.d.ts'))));
  for (const path of ['src/index.ts', 'package.json']) assert.equal(hash(git('show', baseline + ':' + path)), hash(git('show', candidate + ':' + path)));
  successful = true;
} finally {
  for (const [variant, expected] of Object.entries(before)) assert.deepEqual(inventory(join(scratch, variant)), expected);
  assert.equal(hash(readFileSync(join(scratch, 'workloads.json'))), hash(frozen));
  rmSync(scratch, { recursive: true });
  json(join(output, 'cleanup.json'), { successful, commands, beforeAfterTreesMatch: true, scratchRemoved: !existsSync(scratch), loadAfter: loadavg(), remainingOwnedChildren: 0 });
}
console.log(JSON.stringify({ successful, candidate, output }));
