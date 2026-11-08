import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { own, work, hash, write, save, inventory, run } from './harness.mjs';

const source = path.join(work, 'source');
const binding = JSON.parse(fs.readFileSync(path.join(work, 'BINDING.json')));
const baseline = JSON.parse(fs.readFileSync(path.join(work, 'author-baseline.json')));
const mode = process.argv[2];
assert(['build', 'regressions', 'public'].includes(mode));
const node = process.execPath;
const compiler = path.join(source, 'node_modules/typescript/bin/tsc');
const strict = ['--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--strict', '--verbatimModuleSyntax', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--skipLibCheck'];
const rows = [];
const invoke = async (label, command, cwd = source, options) => { const result = await run(label, command, cwd, options); rows.push(result); return result; };
if (mode === 'build') {
  assert.equal((await invoke('build', [node, compiler, '-p', 'tsconfig.build.json'])).status, 0);
  const npm = path.join(path.dirname(process.execPath), 'npm');
  assert.equal((await invoke('pack', [npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', path.join(work, 'pack')])).status, 0);
  const packResult = JSON.parse(fs.readFileSync(path.join(work, 'logs/pack/stdout')));
  assert.equal(packResult.length, 1);
  const tarball = path.join(work, 'pack', packResult[0].filename);
  const consumer = path.join(work, 'consumer-installed');
  fs.mkdirSync(consumer);
  write(path.join(consumer, 'package.json'), '{"type":"module","private":true}\n');
  assert.equal((await invoke('install', [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], consumer)).status, 0);
  for (const name of ['@types/node', 'undici-types']) fs.cpSync(path.join(source, 'node_modules', name), path.join(consumer, 'node_modules', name), { recursive: true, dereference: true });
  const beforeMove = inventory(consumer);
  const moved = path.join(work, 'moved-consumer');
  fs.renameSync(consumer, moved);
  const afterMove = inventory(moved);
  assert(!fs.existsSync(consumer));
  assert.deepEqual(afterMove, beforeMove);
  const product = path.join(moved, 'node_modules/virtual-bash');
  assert.deepEqual(inventory(path.join(product, 'dist')), inventory(path.join(source, 'dist')));
  assert.equal(hash(fs.readFileSync(path.join(product, 'package.json'))), binding.packageManifestSHA256);
  save(path.join(work, 'PACKAGE.json'), { candidate: binding.candidate, source, moved, product, tarball, tarballSHA256: hash(fs.readFileSync(tarball)), packResult, actualPackInstallPhysicalMove: true, originalConsumerAbsent: true, beforeMove, afterMove, installed: inventory(product), built: inventory(path.join(source, 'dist')), rows });
}
if (mode === 'regressions') {
  const runtimeTests = ['state', 'ordering', 'host'].map(name => `tests/shell/getopts/runtime/${name}.test.ts`);
  await invoke('runtime-types', [node, compiler, ...strict, 'tests/shell/getopts/runtime/helpers.ts', ...runtimeTests]);
  await invoke('runtime83', [node, '--unhandled-rejections=strict', '--import', 'tsx', '--test', ...runtimeTests]);
  for (const label of ['focused-types-final-02', 'source-types-final-02', 'focused-final-02', 'legacy-core-final-02', 'legacy-state-final']) await invoke(label, [node, ...baseline.commands[label].slice(1)]);
  save(path.join(work, 'REGRESSIONS.json'), { candidate: binding.candidate, rows, countsOverlap: true, unchangedCandidateSuites: true });
}
if (mode === 'public') {
  const packed = JSON.parse(fs.readFileSync(path.join(work, 'PACKAGE.json')));
  const { moved, product } = packed;
  for (const name of ['independent-public.mjs', 'load-audit.mjs', 'types-positive.ts.data', 'types-negative-options.ts.data', 'types-negative-sink.ts.data', 'types-negative-invoke.ts.data']) fs.copyFileSync(path.join(own, name), path.join(moved, name.replace('.data', '')));
  const publicFixtures = path.join(source, 'tests/integration/owned-output-production-rebase/author-public/fixtures');
  fs.copyFileSync(path.join(publicFixtures, 'public.mjs'), path.join(moved, 'legacy-public.mjs'));
  fs.copyFileSync(path.join(publicFixtures, 'consumer.ts.data'), path.join(moved, 'legacy-consumer.ts'));
  const env = { REVIEW_PACKAGE: product, REVIEW_SOURCE: source, REVIEW_OWN: own, REVIEW_OBSERVATIONS: path.join(work, 'PUBLIC-OBSERVATIONS.json'), REVIEW_TRACE: path.join(work, 'public-loads.jsonl') };
  await invoke('independent-public', [node, '--unhandled-rejections=strict', '--experimental-loader', path.join(moved, 'load-audit.mjs'), '--test', '--test-concurrency=1', path.join(moved, 'independent-public.mjs')], moved, { env });
  await invoke('legacy-moved-public9', [node, '--unhandled-rejections=strict', '--test', 'legacy-public.mjs'], moved);
  for (const name of ['types-positive', 'legacy-consumer', 'types-negative-options', 'types-negative-sink', 'types-negative-invoke']) await invoke(name, [node, compiler, ...strict, '--traceResolution', name + '.ts'], moved);
  await invoke('load-positive', [node, '--experimental-loader', path.join(moved, 'load-audit.mjs'), '--input-type=module', '-e', 'import {Shell} from "virtual-bash"; if(typeof Shell!=="function") throw Error("wrong Shell"); console.log(import.meta.resolve("virtual-bash"))'], moved, { env: { ...env, REVIEW_TRACE: path.join(work, 'load-positive.jsonl') } });
  await invoke('load-negative-wrong-binding', [node, '--experimental-loader', path.join(moved, 'load-audit.mjs'), '--input-type=module', '-e', 'import "virtual-bash"'], moved, { env: { ...env, REVIEW_PACKAGE: path.join(work, 'nonexistent-package'), REVIEW_TRACE: path.join(work, 'load-negative.jsonl') } });
  await invoke('load-negative-internal-export', [node, '--input-type=module', '-e', 'import "virtual-bash/dist/shell/runtime.js"'], moved);
  assert.deepEqual(inventory(product), packed.installed);
  save(path.join(work, 'PUBLIC.json'), { candidate: binding.candidate, rows, installedUnchangedIncludingNewEntries: true });
}
if (rows.some(row => !row.label.startsWith('types-negative-') && !row.label.startsWith('load-negative-') && row.status !== 0)) process.exitCode = 1;
