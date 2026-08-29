import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = '/Users/kjopek/Workspace/safe-bash';
const own = path.dirname(new URL(import.meta.url).pathname);
const author = repo + '/tests/compatibility/bash-ere-engine-author-20260829';
const out = fs.openSync(own + '/prep/prepare.stdout.raw', 'wx');
const err = fs.openSync(own + '/prep/prepare.stderr.raw', 'wx');
const eventFile = fs.openSync(own + '/prep/prepare.events.jsonl', 'wx');
const event = value => fs.writeSync(eventFile, JSON.stringify({ at: Date.now(), ...value }) + '\n');
event({ event: 'capture-open', pid: process.pid });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const children = [];
function run(command, args, input) {
  const child = spawnSync(command, args, { cwd: repo, input, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  fs.writeSync(out, child.stdout ?? Buffer.alloc(0)); fs.writeSync(err, child.stderr ?? Buffer.alloc(0));
  children.push({ pid: child.pid, command, args, status: child.status, signal: child.signal, error: child.error ? String(child.error) : null }); event({ event: 'child-close', ...children.at(-1) });
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.signal, null); return child.stdout;
}
function binding(filename) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && stat.size <= 128 * 1024 * 1024);
  const descriptor = fs.openSync(filename, 'r'); const digest = createHash('sha256');
  try { const buffer = Buffer.alloc(65536); let count; while ((count = fs.readSync(descriptor, buffer)) !== 0) digest.update(buffer.subarray(0, count)); } finally { fs.closeSync(descriptor); }
  return { path: filename, size: stat.size, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
function addFiles(entries) {
  const patch = '*** Begin Patch\n' + entries.map(([name, text]) => '*** Add File: ' + own + '/' + name + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n';
  run('/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], patch);
}
try {
  assert.ok(Date.now() - JSON.parse(fs.readFileSync(own + '/prep/START.json')).at < 780000);
  const authorSealBytes = fs.readFileSync(author + '/r02-v1/SEAL.json');
  assert.equal(hash(authorSealBytes), '20ce8940d07d2c032e4d61d321fbdee68e9e5fb6e1b5a4ca96dbc77de88097d7');
  const seal = JSON.parse(authorSealBytes);
  for (const record of [seal.node, ...seal.sources, ...seal.originals, ...seal.fixtures, ...seal.reversionInputs, ...seal.harness, ...seal.tools]) assert.deepEqual(binding(record.path), record);
  const queries = seal.sources.map(record => '0e97500f41be479e4a266037b03230ab5118d300:' + path.relative(repo, record.path));
  const objects = run('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'cat-file', '--batch'], queries.join('\n') + '\n');
  let offset = 0;
  const sourceGit = [];
  for (const record of seal.sources) {
    const newline = objects.indexOf(10, offset); const header = objects.subarray(offset, newline).toString('ascii').split(' ');
    assert.equal(header[1], 'blob'); assert.equal(Number(header[2]), record.size);
    const bytes = objects.subarray(newline + 1, newline + 1 + record.size); assert.equal(hash(bytes), record.sha256);
    sourceGit.push({ path: path.relative(repo, record.path), gitBlob: header[0], sha256: record.sha256 }); offset = newline + 2 + record.size;
  }
  assert.equal(offset, objects.length);
  let runner = fs.readFileSync(author + '/r02-v1/runner.mjs', 'utf8');
  const transforms = [];
  function change(before, after) { assert.equal(runner.split(before).length, 2, 'unique replacement'); runner = runner.replace(before, after); transforms.push({ before, after }); }
  change("const author = dirname(own); const repo = resolve(own, '../../../..');", `const author = ${JSON.stringify(author)}; const repo = ${JSON.stringify(repo)};`);
  change("if (!['seal','run'].includes(mode)", "if (!['run'].includes(mode)");
  change("const seal = JSON.parse(await text(join(own, 'SEAL.json')));", "const seal = JSON.parse(await text(join(own, 'AUTHOR-SEAL.json')));\n    await bound(JSON.parse(await text(join(own, 'EXECUTOR.json'))).files);");
  change("const script = target ? join(own, 'checkpoints.mjs') : join(author, 'suite.mjs');", "const script = target === 'novel' ? join(own, 'novel.mjs') : target ? join(author, 'r02-v1/checkpoints.mjs') : join(author, 'suite.mjs');");
  change("rows.push({ role, mutated, exitCode: result.code, observed, loaded }); return observed;", "assert.equal(observed.rows.length, selection !== 'all' ? 1 : target === 'novel' ? 6 : target ? 8 : 66, 'SAFETY exact membership');\n      rows.push({ role, mutated, exitCode: result.code, observed, loaded }); return observed;");
  change("await runCases(`${layout}-author66`,directory); await runCases(`${layout}-checkpoints8`,directory,true);", "await runCases(`${layout}-author66`,directory); await runCases(`${layout}-checkpoints8`,directory,true); await runCases(`${layout}-novel6`,directory,'novel');");
  change("negative.code===2 && JSON.stringify(diagnostics)==='[2345,2339,2322]'", "negative.code!==0 && JSON.stringify(diagnostics)==='[2345,2339,2322]' && negative.stdout.includes('negative.mts(4,') && negative.stdout.includes('negative.mts(6,') && negative.stdout.includes('negative.mts(7,')");
  addFiles([['runner.mjs', runner], ['AUTHOR-SEAL.json', authorSealBytes.toString()], ['RUNNER-TRANSFORMS.json', JSON.stringify({ sourceSha256: hash(fs.readFileSync(author + '/r02-v1/runner.mjs')), transforms }, null, 2) + '\n'], ['SOURCE-GIT.json', JSON.stringify(sourceGit, null, 2) + '\n']]);
  for (const filename of ['runner.mjs', 'novel.mjs', 'outer.mjs', 'prepare.mjs']) run(seal.node.path, ['--check', own + '/' + filename]);
  const files = ['runner.mjs', 'novel.mjs', 'outer.mjs', 'prepare.mjs', 'AUTHOR-SEAL.json', 'RUNNER-TRANSFORMS.json', 'SOURCE-GIT.json', 'PRESEAL.md'].map(name => binding(own + '/' + name));
  const executable = JSON.stringify({ node: seal.node, files, productSourceCommit: '0e97500f41be479e4a266037b03230ab5118d300', originalAuthorSeal: hash(authorSealBytes), caseGroups: { author: 66, R02: 8, novel: 6, layouts: 3, main: 240 }, types: 6, mutants: 3, restores: 3, bindings: 2, children: 22, knownActualRolesBeforeAdmin: 24, loaderThreads: 0, workers: 0, noCompression: true, native: false, R01: 'seven historical failures/HOLD not rerun or rescored' }, null, 2) + '\n';
  addFiles([['EXECUTOR.json', executable], ['EXECUTOR.sha256', hash(executable) + '\n']]);
  event({ event: 'sealed', sha256: hash(executable), children: children.length }); console.log(JSON.stringify({ executorSha256: hash(executable), children: children.length, sourceGit }));
} catch (reason) { fs.writeSync(err, String(reason?.stack ?? reason)); event({ event: 'primary', reasonPresent: true, reason: String(reason?.stack ?? reason) }); process.exitCode = 1; }
finally { event({ event: 'capture-closure', children }); fs.closeSync(out); fs.closeSync(err); fs.closeSync(eventFile); }
