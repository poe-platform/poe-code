import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = '/Users/kjopek/Workspace/safe-bash';
const own = path.dirname(new URL(import.meta.url).pathname);
const parent = path.dirname(own);
const author = repo + '/tests/compatibility/bash-ere-engine-author-20260829';
const out = fs.openSync(own + '/prep/prepare-v2.stdout.raw', 'wx');
const err = fs.openSync(own + '/prep/prepare-v2.stderr.raw', 'wx');
const events = fs.openSync(own + '/prep/prepare-v2.events.jsonl', 'wx');
const event = value => fs.writeSync(events, JSON.stringify({ at: Date.now(), ...value }) + '\n');
event({ event: 'capture-open', pid: process.pid });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const children = [];
function run(command, args, input) {
  const child = spawnSync(command, args, { cwd: repo, input, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  fs.writeSync(out, child.stdout ?? Buffer.alloc(0)); fs.writeSync(err, child.stderr ?? Buffer.alloc(0));
  children.push({ pid: child.pid, command, args, status: child.status, signal: child.signal, error: child.error ? String(child.error) : null });
  event({ event: 'child-close', ...children.at(-1) });
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.signal, null); return child.stdout;
}
function binding(filename) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && stat.size <= 128 * 1024 * 1024);
  const digest = createHash('sha256'); const descriptor = fs.openSync(filename, 'r');
  try { const buffer = Buffer.alloc(65536); let count; while ((count = fs.readSync(descriptor, buffer)) !== 0) digest.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  return { path: filename, size: stat.size, mode: stat.mode & 511, sha256: digest.digest('hex') };
}
function addFiles(entries) {
  const patch = '*** Begin Patch\n' + entries.map(([name, text]) => '*** Add File: ' + own + '/' + name + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n';
  run('/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], patch);
}
try {
  assert.ok(Date.now() - JSON.parse(fs.readFileSync(own + '/prep/START.json')).at < 480000);
  const sealBytes = fs.readFileSync(author + '/r02-v2/SEAL.json');
  assert.equal(hash(sealBytes), '4f6d24661fc75ab4f2bc26836a735f998a88591caf377fddff36f45709799b12');
  const seal = JSON.parse(sealBytes);
  for (const row of [seal.node, ...seal.sources, ...seal.originals, ...seal.fixtures, ...seal.reversionInputs, ...seal.harness, ...seal.tools]) assert.deepEqual(binding(row.path), row);
  const predecessorBytes = fs.readFileSync(parent + '/EXECUTOR.json');
  assert.equal(hash(predecessorBytes), '1211bb61a49e55f154570cb6bd57f3a1d076579c13822fc48fd5db881369328d');
  const predecessor = JSON.parse(predecessorBytes);
  for (const name of ['novel.mjs', 'outer.mjs']) assert.deepEqual(binding(parent + '/' + name), predecessor.files.find(row => row.path === parent + '/' + name));
  const queries = seal.sources.map(row => 'b5f2464f63172fc7c92bcfd33fbb2a8a6d8c03eb:' + path.relative(repo, row.path));
  queries.push('b3d9e294417715e2aeded43b997c374f05d60180:tests/compatibility/bash-ere-engine-author-20260829/r02-v1/ACTUAL-01/RESULT.json');
  const batch = run('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'cat-file', '--batch'], queries.join('\n') + '\n');
  let offset = 0; const objects = [];
  for (const query of queries) {
    const newline = batch.indexOf(10, offset); const header = batch.subarray(offset, newline).toString('ascii').split(' ');
    assert.equal(header[1], 'blob'); const size = Number(header[2]); assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= 1048576);
    const bytes = batch.subarray(newline + 1, newline + 1 + size); assert.equal(bytes.length, size);
    assert.equal(createHash('sha1').update(Buffer.from(`blob ${size}\0`)).update(bytes).digest('hex'), header[0]);
    objects.push({ query, gitBlob: header[0], size, sha256: hash(bytes), bytes }); offset = newline + 2 + size;
  }
  assert.equal(offset, batch.length);
  for (let index = 0; index < seal.sources.length; index++) { assert.equal(objects[index].sha256, seal.sources[index].sha256); assert.equal(objects[index].size, seal.sources[index].size); }
  const declarations = JSON.parse(objects.at(-1).bytes).emittedBindings.filter(row => row.path.endsWith('.d.ts'));
  assert.equal(declarations.length, 5); for (const row of declarations) assert.deepEqual(binding(row.path), row);
  const oldSyntax = fs.readFileSync(seal.originals.find(row => row.path.endsWith('/syntax.ts')).path, 'utf8');
  const syntax = fs.readFileSync(seal.sources.find(row => row.path.endsWith('/syntax.ts')).path, 'utf8');
  const insertion = '    ledger.charge("work", 1, signal);\n    ledger.admitInput("patternBytes", fragment.text.length, signal);';
  assert.equal(oldSyntax.split(insertion).length, 2);
  assert.equal(syntax, oldSyntax.replace(insertion, insertion.replace('\n', '\n    await ledger.checkpoint(signal);\n')));
  for (let index = 0; index < 5; index++) if (!seal.sources[index].path.endsWith('/syntax.ts')) assert.equal(seal.sources[index].sha256, seal.originals[index].sha256);
  const oldNovel = fs.readFileSync(parent + '/novel.mjs', 'utf8');
  const empty = fs.readFileSync(author + '/r02-v2/empty.mjs', 'utf8');
  function body(text, id) { const begin = text.indexOf(`await check('${id}'`); assert.ok(begin >= 0); const end = text.indexOf('\n});', begin); assert.ok(end > begin); return text.slice(begin, end + 5); }
  const n01 = body(oldNovel, 'N01-empty-fragment-first-pass'); assert.equal(n01, body(empty, 'N01-empty-fragment-first-pass'));
  const observer = text => text.slice(text.indexOf('class Ledger extends'), text.indexOf("await check('N01"));
  assert.equal(observer(oldNovel), observer(empty));
  const remaining = oldNovel.replace(n01, ''); assert.equal((remaining.match(/await check\('/g) ?? []).length, 5);
  let runner = fs.readFileSync(author + '/r02-v2/runner.mjs', 'utf8'); const transforms = [];
  function change(before, after) { assert.equal(runner.split(before).length, 2, 'unique runner replacement'); runner = runner.replace(before, after); transforms.push({ before, after }); }
  change("const author = dirname(own); const repo = resolve(own, '../../../..');", `const author = ${JSON.stringify(author)}; const repo = ${JSON.stringify(repo)};`);
  change("if (!['seal','run'].includes(mode)", "if (!['run'].includes(mode)");
  change("const seal = JSON.parse(await text(join(own, 'SEAL.json')));", "const seal = JSON.parse(await text(join(own, 'AUTHOR-SEAL.json')));\n    await bound(JSON.parse(await text(join(own, 'EXECUTOR.json'))).files);");
  change("const emittedBindings = await census(emitted);", "const emittedBindings = await census(emitted);\n    for (const expected of JSON.parse(await text(join(own, 'DECLARATIONS.json')))) { const actual = await hash(join(emitted, basename(expected.path))); assert.deepEqual({ ...actual, path: expected.path }, expected, 'SAFETY unchanged declaration identity'); }");
  change("const script = target === 'empty' ? join(own, 'empty.mjs') : target ? join(own, 'checkpoints.mjs') : join(author, 'suite.mjs');", "const script = target === 'remaining' ? join(own, 'remaining.mjs') : target === 'empty' ? join(author, 'r02-v2/empty.mjs') : target ? join(author, 'r02-v2/checkpoints.mjs') : join(author, 'suite.mjs');");
  change("rows.push({ role, mutated, exitCode: result.code, observed, loaded }); return observed;", "assert.equal(observed.rows.length, selection !== 'all' ? 1 : target === 'remaining' ? 5 : target === 'empty' ? 4 : target ? 8 : 66, 'SAFETY exact membership');\n      rows.push({ role, mutated, exitCode: result.code, observed, loaded }); return observed;");
  const loopBegin = runner.indexOf('    const mutations = [');
  const loopEnd = runner.indexOf("    const bad = join(work,'binding-negative.js');", loopBegin);
  assert.ok(loopBegin > 0 && loopEnd > loopBegin);
  const mutationBlock = runner.slice(loopBegin, loopEnd);
  let functionBody = mutationBlock.replace('    const mutants = [];\n', '');
  functionBody = functionBody.replace('const location = join(emitted,`${spec.name}.js`);', 'const location = join(directory,`${spec.name}.js`);');
  functionBody = functionBody.replace("runCases(spec.id,emitted,'empty',spec.selection,spec.name)", "runCases(`${layout}-${spec.id}`,directory,'empty',spec.selection,spec.name)");
  functionBody = functionBody.replace("await bound(emittedBindings); const restored=await runCases(`${spec.id}-restore`,emitted,'empty',spec.selection);", "await bound(emittedBindings.map(entry => ({ ...entry, path: join(directory, basename(entry.path)) }))); const restored=await runCases(`${layout}-${spec.id}-restore`,directory,'empty',spec.selection);");
  functionBody = functionBody.replace('mutants.push({id:spec.id,activated:true', 'mutants.push({id:spec.id,layout,activated:true');
  runner = runner.slice(0, loopBegin) + runner.slice(loopEnd);
  change("    const app = join(work,'installed-app'); await mkdir(join(app,'artifact'),{recursive:true}); await writeFile(join(app,'package.json'),'{\"type\":\"module\"}\\n');", "    const mutants = [];\n    async function mutateLayout(directory, layout) {\n" + functionBody + "    }\n    const app = join(work,'installed-app'); await mkdir(join(app,'artifact'),{recursive:true}); await writeFile(join(app,'package.json'),'{\"type\":\"module\"}\\n');");
  const targetLine = runner.split('\n').find(line => line.includes('await runCases(`${layout}-author66`'));
  assert.ok(targetLine); change(targetLine, targetLine + " await runCases(`${layout}-remaining5`,directory,'remaining');");
  const typeLine = runner.split('\n').find(line => line.includes('types.push({layout'));
  assert.ok(typeLine); change(typeLine, typeLine.replace('negative.code===2', 'negative.code!==0').replace("JSON.stringify(diagnostics)==='[2345,2339,2322]'", "JSON.stringify(diagnostics)==='[2345,2339,2322]' && negative.stdout.includes('negative.mts(4,') && negative.stdout.includes('negative.mts(6,') && negative.stdout.includes('negative.mts(7,')") + '\n      await mutateLayout(directory,layout);');
  change('captureBytes > 128 * 1024 * 1024', 'captureBytes > 96 * 1024 * 1024');
  const outer = fs.readFileSync(parent + '/outer.mjs', 'utf8').replace('1950000', '1380000');
  const map = { source: 'b5f2464f63172fc7c92bcfd33fbb2a8a6d8c03eb', inputs: objects.map(({ bytes, ...record }) => record), singleAwaitOnly: true, exactN01: hash(n01), observer: hash(observer(oldNovel)), remainingBodies: [...remaining.matchAll(/await check\('([^']+)'/g)].map(match => ({ id: match[1], sha256: hash(body(remaining, match[1])), unchanged: body(remaining, match[1]) === body(oldNovel, match[1]) })), main: 249, sourceQualifiedNoR01Rescore: true };
  assert.ok(map.remainingBodies.every(row => row.unchanged));
  addFiles([['runner.mjs', runner], ['outer.mjs', outer], ['remaining.mjs', remaining], ['AUTHOR-SEAL.json', sealBytes.toString()], ['DECLARATIONS.json', JSON.stringify(declarations, null, 2) + '\n'], ['SOURCE-FIXTURE-MAP.json', JSON.stringify(map, null, 2) + '\n'], ['TRANSFORMS.json', JSON.stringify(transforms, null, 2) + '\n']]);
  for (const name of ['runner.mjs', 'outer.mjs', 'remaining.mjs', 'prepare-v2.mjs']) run(seal.node.path, ['--check', own + '/' + name]);
  const files = ['runner.mjs', 'outer.mjs', 'remaining.mjs', 'prepare-v2.mjs', 'AUTHOR-SEAL.json', 'DECLARATIONS.json', 'SOURCE-FIXTURE-MAP.json', 'TRANSFORMS.json', 'PRESEAL.md'].map(name => binding(own + '/' + name));
  const executable = JSON.stringify({ node: seal.node, files, source: map.source, authorSealSha256: hash(sealBytes), mainGroups: 249, layouts: 3, typeExecutions: 6, expectedNegativeDiagnostics: 9, declarationFiles: 5, mutationFamilies: 1, kills: 3, restores: 3, bindingRefusals: 2, childCount: 25, runtimeRoles: 27, loaders: 0, workers: 0, noCompression: true, R01: 'seven original failures/HOLD not rerun or rescored' }, null, 2) + '\n';
  addFiles([['EXECUTOR.json', executable], ['EXECUTOR.sha256', hash(executable) + '\n']]);
  event({ event: 'sealed', sha256: hash(executable), children }); console.log(JSON.stringify({ sha256: hash(executable), children: children.length, map: { exactN01: map.exactN01, main: map.main, remaining: map.remainingBodies } }, null, 2));
} catch (reason) { fs.writeSync(err, String(reason?.stack ?? reason)); event({ event: 'primary', reasonPresent: true, reason: String(reason?.stack ?? reason) }); process.exitCode = 1; }
finally { event({ event: 'capture-closure', children }); fs.closeSync(out); fs.closeSync(err); fs.closeSync(events); }
