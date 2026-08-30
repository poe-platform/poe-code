import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const report = dirname(fileURLToPath(import.meta.url));
const repo = resolve(report, '../../../..');
const require = createRequire(join(repo, 'package.json'));
const ts = require('typescript');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.ok(process.argv.includes('--capture'));
const output = resolve(process.argv[2]);
assert.ok(output.startsWith(report + '/caps-'));
mkdirSync(output);
const scratch = join(output, 'scratch'); mkdirSync(scratch);
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const commands = [];
const run = (label, args) => {
  const result = spawnSync('/bin/sh', ['-c', 'ulimit -t 60; exec "$@"', 'author-caps', process.execPath, '--max-old-space-size=512', ...args], { cwd: repo, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(output, label + '.stdout'), result.stdout ?? '', { flag: 'wx' });
  writeFileSync(join(output, label + '.stderr'), result.stderr ?? '', { flag: 'wx' });
  commands.push({ label, args, status: result.status, signal: result.signal, closed: true });
  assert.equal(result.status, 0, label); return JSON.parse(result.stdout);
};
const inventory = root => {
  const files = {};
  const visit = directory => { for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path); else files[path] = hash(readFileSync(join(root, path)));
  } }; visit(''); return files;
};
const freeze = JSON.parse(readFileSync(join(report, 'attempt-1/freeze.json')));
const worker = join(report, 'cap-worker.mjs');
const descriptions = run('freeze-descriptions', [worker, '--describe']);
const pack = join(report, 'attempt-1/candidate-package.tgz');
assert.equal(hash(readFileSync(pack)), freeze.package.sha256);
execFileSync('/usr/bin/tar', ['-xzf', pack, '-C', scratch]);
const candidate = join(scratch, 'package');
const sources = {};
const before = {};
let successful = false;
try {
  for (const variant of ['baseline-text-instrumented', 'candidate', 'candidate-instrumented']) {
    const root = join(scratch, variant); cpSync(candidate, root, { recursive: true });
    if (variant !== 'candidate') for (const file of ['text', 'internal']) {
      const name = variant.startsWith('baseline') ? 'baseline' : 'candidate';
      const source = readFileSync(join(report, `attempt-1/${name}-${file}.ts.txt`), 'utf8');
      assert.equal(hash(source), freeze.instrumentation.find(entry => entry.variant === name && entry.path === `src/commands/${file}.ts`).sha256);
      const emitted = ts.transpileModule(source, { fileName: `${file}.ts`, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText;
      writeFileSync(join(root, `dist/commands/${file}.js`), emitted);
      sources[variant + '/' + file] = { sourceSha256: hash(source), emittedSha256: hash(emitted) };
    }
    before[variant] = inventory(root);
  }
  json(join(output, 'freeze.json'), { candidate: freeze.candidate, packageSha256: freeze.package.sha256, tools: freeze.tools, descriptions, workerSha256: hash(readFileSync(worker)), runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), sources, loadedTrees: before, method: 'Candidate packed runtime in all variants; baseline text/internal instrumentation substituted only for a same-runtime counterfactual. Instrumented modules use isolated ES2023/ES2022 transpilation, not product build. Full committed baseline separately passed frozen21.' });
  const results = {};
  for (const variant of Object.keys(before)) {
    const result = run(variant, [worker, join(scratch, variant)]); results[variant] = result;
    json(join(output, variant + '.json'), result);
    assert.deepEqual(result.descriptions, descriptions);
  }
  const counts = Object.fromEntries(results['candidate-instrumented'].rows.map(row => [row.id, row.counts]));
  for (const [id, count] of Object.entries(counts)) {
    assert.ok((count.cacheEntries ?? 0) <= 16384); assert.ok((count.cacheRetainedBytes ?? 0) <= 1048576);
    if (id.startsWith('guard-')) assert.equal(count.cacheCreated ?? 0, 0, id);
  }
  assert.equal(counts['empty-entry-cap'].cacheEntries, 16384);
  assert.ok(counts['empty-entry-cap'].cacheFallbacks > 0);
  assert.equal(counts['character-cap-exact-with-empty'].cacheRetainedBytes, 1048576);
  assert.ok(counts['character-cap-exact-with-empty'].cacheFallbacks > 0);
  assert.ok(counts['character-cap-many-decimals'].cacheFallbacks > 0);
  assert.equal(counts['large-tail-small-value-bypass'].cacheEntries, 2);
  assert.ok(counts['large-tail-small-value-bypass'].cacheFallbacks > 0);
  successful = true;
} finally {
  for (const [variant, expected] of Object.entries(before)) assert.deepEqual(inventory(join(scratch, variant)), expected);
  rmSync(scratch, { recursive: true });
  json(join(output, 'cleanup.json'), { successful, commands, beforeAfterTreesMatch: true, scratchRemoved: true, remainingOwnedChildren: 0 });
}
console.log(JSON.stringify({ successful, output }));
