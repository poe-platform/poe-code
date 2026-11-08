import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, root, product, canonical, frozen, hash, save, put, inventory, command } from './lib.mjs';

const state = JSON.parse(readFileSync(join(owned, process.argv[2], 'state.json')));
if (process.argv[4]) {
  state.output = join(owned, process.argv[4]); mkdirSync(state.output);
  for (const key of ['scratch', 'source', 'installed', 'temporary', 'moved']) state[key] = realpathSync(state[key]);
  state.env.TMPDIR = state.temporary;
  state.harness = join(state.scratch, 'harness' + process.argv[4]);
  save(join(state.output, 'state.json'), state);
}
const auditDirectory = join(owned, process.argv[3]);
const audit = JSON.parse(readFileSync(join(auditDirectory, 'audit.json')));
assert.equal(audit.canonicalCommit, '860967af44b20918e3096230f6c7445d4c9cf133');
const { scratch, source, output, installed, temporary, env } = state;
const suffix = process.argv[4] ?? '';
const harness = join(scratch, 'harness' + suffix);
mkdirSync(harness);
const records = JSON.parse(readFileSync(join(auditDirectory, 'author/MANIFEST.json.data'))).records;
for (const record of records) {
  const bytes = readFileSync(join(auditDirectory, 'author', record.path + '.data'));
  assert.equal(hash(bytes), record.sha256);
  put(join(harness, record.path), bytes);
}
const ts = await import(pathToFileURL(join(root, 'node_modules/typescript/lib/typescript.js')).href);
const bindings = [];
for (const profile of ['original', 'revised']) {
  const typed = join(scratch, profile + '-typed' + suffix);
  mkdirSync(typed); symlinkSync(join(source, 'src'), join(typed, 'src'));
  put(join(typed, 'package.json'), '{"type":"module"}\n');
  const emitted = join(harness, profile, 'emitted'); mkdirSync(emitted);
  put(join(emitted, 'package.json'), '{"type":"module"}\n');
  for (const path of [...canonical, 'tests/commands/expr/helpers.ts']) {
    const body = path.endsWith('/contracts.test.ts') ? readFileSync(join(harness, profile, 'canonical/contracts.test.ts.data'), 'utf8') : frozen(path, product).toString();
    put(join(typed, path), body);
    const filename = path.split('/').at(-1).replace(/\.ts$/, '.js');
    const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true }, fileName: path }).outputText;
    const replacements = [];
    const bound = js.replace(/(["'])\.\.\/\.\.\/\.\.\/src\/([^"']+)\1/g, (match, quote, suffix) => {
      const target = pathToFileURL(join(installed, 'dist', suffix)).href;
      replacements.push({ before: match, after: quote + target + quote });
      return quote + target + quote;
    });
    let reversed = bound;
    for (const { before, after } of replacements) reversed = reversed.replace(after, before);
    assert.equal(reversed, js, 'binding-only reversible emitted imports; assertions unchanged');
    put(join(emitted, filename), bound);
    put(join(output, 'emitted', profile, filename + '.data'), bound);
    bindings.push({ profile, path, sourceSha256: hash(body), emittedBeforeSha256: hash(js), emittedAfterSha256: hash(bound), replacements, assertionBytesUnchanged: true });
  }
  const config = { extends: join(source, 'tsconfig.json'), compilerOptions: { noEmit: true, skipLibCheck: false, typeRoots: [join(root, 'node_modules/@types')] }, files: canonical.map(path => join(typed, path)), include: [], exclude: [] };
  save(join(typed, 'review.json'), config);
  save(join(output, profile + '-typeconfig.json'), config);
}
save(join(output, 'binding-only-deltas.json'), bindings);
save(join(output, 'execution-freeze.json'), { frozenAt: new Date().toISOString(), harness: inventory(harness), drivers: Object.fromEntries(['lib.mjs', 'replay.mjs', 'import-guard.mjs'].map(name => [name, hash(readFileSync(join(owned, name)))])), source: hash(JSON.stringify(inventory(join(source, 'src')))), installed: hash(JSON.stringify(inventory(installed))) });
const summary = {};
for (const profile of ['original', 'revised']) {
  const destination = join(output, profile); mkdirSync(destination);
  const typed = command(output, profile + '-types', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(scratch, profile + '-typed' + suffix, 'review.json')], scratch, env);
  assert.equal(typed.status, 0, typed.stdout + typed.stderr);
  const canonicalRun = command(output, profile + '-canonical237', process.execPath, ['--import', join(owned, 'import-guard.mjs'), '--test', '--test-reporter=spec', ...canonical.map(path => join(harness, profile, 'emitted', path.split('/').at(-1).replace(/\.ts$/, '.js')))], state.moved, { ...env, REVIEW_INSTALLED: installed, REVIEW_IMPORT_LOG: join(output, profile + '-canonical-imports.jsonl') });
  const counts = Object.fromEntries([...canonicalRun.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const quotaRun = command(output, profile + '-quota47', process.execPath, [join(harness, profile, 'quota/probe.mjs'), installed, join(destination, 'quota47.json')], state.moved, env);
  const nearbyRun = command(output, profile + '-nearby16', process.execPath, [join(harness, 'support/nearby-driver.mjs'), installed, join(harness, profile, 'nearby/controls.json')], state.moved, env);
  if (nearbyRun.status === 0) save(join(destination, 'nearby16.json'), JSON.parse(nearbyRun.stdout));
  const coreRun = command(output, profile + '-core146', process.execPath, [join(harness, 'support/core-bound.mjs'), 'independent-' + profile], state.moved, { ...env, REVIEW_INSTALLED: installed, REVIEW_COMMIT: product, REVIEW_ROOT: root, REVIEW_PROFILE: profile, REVIEW_OUTPUT: destination, REVIEW_TMP: temporary, REVIEW_TAR_SHA256: state.packageSha256 });
  assert.equal(quotaRun.status, 0, quotaRun.stderr); assert.equal(nearbyRun.status, 0, nearbyRun.stderr); assert.equal(coreRun.status, 0, coreRun.stderr);
  const quotaRows = JSON.parse(readFileSync(join(destination, 'quota47.json')));
  const nearbyRows = JSON.parse(nearbyRun.stdout);
  const coreRows = JSON.parse(readFileSync(join(destination, 'core-controls.json')));
  summary[profile] = { canonical: { status: canonicalRun.status, ...counts }, quota: { passed: quotaRows.passed, total: quotaRows.total, failed: quotaRows.rows.filter(row => !row.passed).map(row => row.input.id), safetyTerminations: quotaRows.safetyTerminations }, nearby: { passed: nearbyRows.cases.filter(row => row.passed).length, total: nearbyRows.cases.length, failed: nearbyRows.cases.filter(row => !row.passed).map(row => row.id), activeWorkers: nearbyRows.activeWorkers }, core: { passed: coreRows.rows.filter(row => row.passed).length, total: coreRows.rows.length, failed: coreRows.failedSubcases, realVfsScratchRemoved: coreRows.realVfsScratchRemoved } };
  save(join(destination, 'summary.json'), summary[profile]);
  console.log(JSON.stringify({ profile, ...summary[profile] }));
}
save(join(output, 'replay-summary.json'), summary);
save(join(output, 'harness-after.json'), inventory(harness));
assert.deepEqual(inventory(harness), JSON.parse(readFileSync(join(output, 'execution-freeze.json'))).harness);
