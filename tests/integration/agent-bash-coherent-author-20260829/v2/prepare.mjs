import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(own, '../../../..');
const mode = process.argv[2];
assert.ok(['--inspect', '--compose', '--details', '--seal'].includes(mode));
const capture = path.join(own, 'capture');
const events = fs.openSync(path.join(capture, mode.slice(2) + '.events.jsonl'), 'wx');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const oid = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const note = value => fs.writeSync(events, JSON.stringify(value) + '\n');
const put = (name, value) => fs.writeFileSync(path.join(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
let children = 0;
function local(name, maximum = 1048576) {
  assert.ok(!name.split('/').includes('AGENTS.md'));
  const stat = fs.lstatSync(name);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(name);
  assert.equal(bytes.length, stat.size);
  return bytes;
}
async function binary(filename, expected) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 134217728);
  const digest = createHash('sha256'); let total = 0;
  for await (const chunk of fs.createReadStream(filename)) { total += chunk.length; assert.ok(total <= stat.size); digest.update(chunk); }
  const actual = digest.digest('hex'); assert.equal(actual, expected); assert.equal(total, stat.size);
  return { path: filename, bytes: total, sha256: actual, mode: stat.mode & 0o777 };
}
function git(args, input, maximum = 16777216) {
  const prefix = path.join(capture, mode.slice(2) + '-git-' + children++);
  const output = fs.openSync(prefix + '.stdout', 'wx'), error = fs.openSync(prefix + '.stderr', 'wx');
  let result;
  try { result = spawnSync('/usr/bin/git', args, { cwd: repo, input, stdio: ['pipe', output, error], timeout: 30000, env: { PATH: '/usr/bin:/bin', HOME: '/tmp', GIT_OPTIONAL_LOCKS: '0' } }); }
  finally { fs.closeSync(output); fs.closeSync(error); }
  note({ pid: result.pid, args, status: result.status, signal: result.signal, spawnError: result.error?.code, role: 'DEVELOPMENT_METADATA_NOT_ORACLE' });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
  return local(prefix + '.stdout', maximum);
}
function blobs(references) {
  assert.ok(references.length <= 400);
  for (const reference of references) assert.ok(!reference.includes('AGENTS.md') && !/[\r\n\0]/.test(reference));
  const meta = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], references.join('\n') + '\n', 131072).toString().trimEnd().split('\n');
  assert.equal(meta.length, references.length);
  const rows = meta.map((line, index) => {
    const match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(line); assert.ok(match, references[index]);
    const bytes = Number(match[2]); assert.ok(Number.isSafeInteger(bytes) && bytes <= 1048576);
    return { reference: references[index], blob: match[1], bytes };
  });
  const total = rows.reduce((sum, row) => sum + row.bytes + 128, 0); assert.ok(total <= 16777216);
  const buffer = git(['cat-file', '--batch'], rows.map(row => row.blob).join('\n') + '\n', total);
  let cursor = 0; const result = new Map();
  for (const row of rows) {
    const end = buffer.indexOf(10, cursor); assert.ok(end >= cursor);
    assert.equal(buffer.subarray(cursor, end).toString(), `${row.blob} blob ${row.bytes}`);
    const body = buffer.subarray(end + 1, end + 1 + row.bytes); assert.equal(body.length, row.bytes);
    assert.equal(oid('blob', body), row.blob); assert.equal(buffer[end + 1 + row.bytes], 10);
    result.set(row.reference, { ...row, sha256: sha(body), body }); cursor = end + row.bytes + 2;
  }
  assert.equal(cursor, buffer.length); return result;
}
const design = '4cc28cdb';
const oldPath = 'tests/integration/agent-bash-coherent-design-20260829/';
const n14 = '4a0268f2561d3b2aabf7511656baad968ee64986';
try {
  note({ started: new Date().toISOString(), pid: process.pid, parent: process.ppid, mode, productExecutions: 0 });
  const tools = {
    node: await binary('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'),
    git: await binary('/usr/bin/git', '12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba'),
  };
  assert.equal(process.execPath, tools.node.path); assert.equal(process.version, 'v22.22.2');
  if (mode === '--inspect') {
    const references = [
      design + ':' + oldPath + 'COMPOSITION.json', design + ':' + oldPath + 'TREE-WITNESSES.json',
      design + ':' + oldPath + 'SOURCE-TREE-INVENTORY.json', design + ':' + oldPath + 'EVIDENCE.md',
      n14 + ':tests/compatibility/bash-strict-extension-author-20260829/n14-v4/SOURCE.json',
      n14 + ':tests/compatibility/bash-strict-extension-author-20260829/n14-v4/PRESEAL-v4.json',
      'bb4dd0571a0335b20e29448bf88126ca02c1a32d:tests/integration/node-public-author-20260829/public-node.mjs',
      'b7dc87ff84a45567dc8d912cc15dd10f089ed68a:tests/integration/agent-bash-coherent-independent-20260829/PROBES.json',
    ];
    const admitted = blobs(references);
    put('RECEIPTS.json', [...admitted.values()].map(({ body, ...row }) => row));
    const composition = JSON.parse(admitted.get(references[0]).body);
    const source = JSON.parse(admitted.get(references[4]).body);
    assert.ok(Array.isArray(composition.shippingInputPaths)); assert.ok(Array.isArray(source.inputs));
    put('TOOLS-PREP.json', tools);
    console.log(JSON.stringify({ keys: Object.keys(composition), sourceKeys: Object.keys(source), sourceRow: source.inputs.find(row => row.path === 'src/shell/runtime.ts'), nodeFiles: composition.shippingInputPaths.filter(row => row.path.startsWith('src/commands/node/')), toolBindings: source.toolBindings }, null, 2));
    console.log('NODE_PUBLIC_FIXTURE\n' + admitted.get(references[6]).body.toString());
    console.log('EVIDENCE\n' + admitted.get(references[3]).body.toString());
    console.log('INDEPENDENT_PROBES\n' + admitted.get(references[7]).body.toString());
    const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=no'], undefined, 1048576);
    console.log('TRACKED_STATUS_BYTES', status.length);
    git(['diff', '--cached', '--name-only', '-z'], undefined, 1048576);
  } else if (mode === '--compose') {
    const references = [design + ':' + oldPath + 'COMPOSITION.json', design + ':' + oldPath + 'TREE-WITNESSES.json', design + ':' + oldPath + 'SOURCE-TREE-INVENTORY.json', n14 + ':tests/compatibility/bash-strict-extension-author-20260829/n14-v4/SOURCE.json', n14 + ':tests/compatibility/bash-strict-extension-author-20260829/n14-v4/prepare.mjs', n14 + ':tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json', n14 + ':tests/compatibility/bash-strict-extension-author-20260829/n14-v4/run-v5.mjs'];
    const records = blobs(references);
    const prior = JSON.parse(records.get(references[0]).body), previousTrees = JSON.parse(records.get(references[1]).body), srcInventory = JSON.parse(records.get(references[2]).body), replacement = JSON.parse(records.get(references[3]).body);
    assert.equal(prior.computedTree, 'df748fb93484479a695928b6849d1df8fbfaee3c');
    assert.equal(replacement.computedTree, 'bf079ada185a79aec864b068f3738ddc5520822e');
    const runtime = replacement.inputs.find(row => row.path === 'src/shell/runtime.ts');
    assert.equal(runtime.blob, 'df6b2c0dfad8d7412f93f434d07a20b2b9375a86');
    const inputs = prior.shippingInputPaths.map(row => row.path === runtime.path ? { ...runtime, origin: 'ROOT_ACCEPTED_719_N14_QUALIFIED_SOURCE' } : row);
    assert.equal(inputs.length, 309); assert.equal(new Set(inputs.map(row => row.path)).size, 309);
    assert.ok(inputs.every(row => !row.path.split('/').includes('AGENTS.md') && !row.path.startsWith('dist/') && !row.path.startsWith('tests/') && !/^src\/commands\/(yq|xan)\//.test(row.path)));
    const objects = blobs([...new Set(inputs.map(row => row.blob))]);
    for (const row of inputs) { const object = objects.get(row.blob); assert.equal(object.bytes, row.bytes, row.path); assert.equal(object.sha256, row.sha256, row.path); }
    const trees = new Map(previousTrees.map(row => { const body = Buffer.from(row.base64, 'base64'); assert.equal(oid('tree', body), row.oid); return [row.oid, body]; }));
    function entries(body) {
      const result = []; let cursor = 0;
      while (cursor < body.length) { const space = body.indexOf(32, cursor), nul = body.indexOf(0, space); assert.ok(space > cursor && nul > space && nul + 21 <= body.length); const nameBytes = body.subarray(space + 1, nul), name = nameBytes.toString(); assert.ok(Buffer.from(name).equals(nameBytes) && !name.includes('/')); result.push({ mode: body.subarray(cursor, space).toString(), name, blob: body.subarray(nul + 1, nul + 21).toString('hex') }); cursor = nul + 21; }
      return result;
    }
    const changedTrees = [];
    function update(tree, components) {
      const body = trees.get(tree); assert.ok(body, tree); const rows = entries(body), target = rows.find(row => row.name === components[0]); assert.ok(target);
      target.blob = components.length === 1 ? runtime.blob : update(target.blob, components.slice(1));
      const next = Buffer.concat(rows.map(row => Buffer.concat([Buffer.from(row.mode + ' ' + row.name + '\0'), Buffer.from(row.blob, 'hex')])));
      const identity = oid('tree', next); trees.set(identity, next); changedTrees.push({ oid: identity, base64: next.toString('base64') }); return identity;
    }
    const computedTree = update(prior.computedTree, runtime.path.split('/'));
    const nodeFiles = inputs.filter(row => row.path.startsWith('src/commands/node/')); assert.equal(nodeFiles.length, 16);
    for (const row of nodeFiles) assert.deepEqual(row, prior.shippingInputPaths.find(old => old.path === row.path));
    const sourceRows = srcInventory.map(row => row.path === runtime.path ? { ...row, blob: runtime.blob } : row);
    function traverse(tree, prefix) { const result = []; for (const row of entries(trees.get(tree))) { const name = prefix ? prefix + '/' + row.name : row.name; if (row.mode === '40000') result.push(...traverse(row.blob, name)); else result.push({ path: name, mode: row.mode, blob: row.blob }); } return result; }
    const srcTree = entries(trees.get(computedTree)).find(row => row.name === 'src');
    const walked = traverse(srcTree.blob, 'src').sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    assert.equal(walked.length, 305);
    for (const row of walked) { const expected = sourceRows.find(item => item.path === row.path); assert.ok(expected); assert.equal(row.blob, expected.blob); assert.equal(Number.parseInt(row.mode, 8), Number.parseInt(expected.mode, 8)); }
    const pkg = JSON.parse(objects.get(inputs.find(row => row.path === 'package.json').blob).body);
    assert.deepEqual(pkg.dependencies ?? {}, {}); assert.deepEqual(pkg.files, ['dist']);
    const source = { role: 'PROPOSED_ACCEPTED_COMPONENT_COMPOSITION_SOURCE_DATA_ONLY', date: '2026-08-29', base: prior.base, previousDesign: prior.computedTree, computedTree, derivedOnly: true, inputs, inputCount: inputs.length, sourceTsCount: inputs.filter(row => row.path.startsWith('src/') && row.path.endsWith('.ts')).length, completeSrcFiles: walked.length, exactReplacement: runtime, unchangedNodeFiles: nodeFiles, reconstructedTrees: changedTrees, priorTreeWitnesses: { ...records.get(references[1]), body: undefined }, prerequisites: { node: 'ROOT_ACCEPTED_6f449bf4', unit3: 'ROOT_ACCEPTED_cccd876f', n14: 'ROOT_ACCEPTED_FINITE_SOURCE_SEMANTICS; old campaign admission noncompliant; prospective aede1639 not retrospective' }, package: { expectedNames: 80, predictedMembers: 1014, actualMembers: null, sha256: null, metadata: pkg, noRuntimeDependencies: true }, productExecutions: 0 };
    put('SOURCE.json', source); put('SOURCE-TREE.json', walked); put('TREE-WITNESSES.json', [...trees].map(([identity, body]) => ({ oid: identity, base64: body.toString('base64') })));
    fs.writeFileSync(path.join(own, 'SHIPPING-PATHS.nul'), Buffer.concat(inputs.map(row => Buffer.from(row.path + '\0'))), { flag: 'wx' });
    fs.writeFileSync(path.join(own, 'NEUTRAL-FIXTURE.json'), records.get(references[5]).body, { flag: 'wx' });
    put('SOURCE-AUTHORITIES.json', [...records.values()].map(({ body, ...row }) => row));
    put('INHERITED-TOOL-BINDINGS.json', replacement.toolBindings);
    console.log(JSON.stringify({ computedTree, inputs: inputs.length, ts: source.sourceTsCount, src: walked.length, predictedPackageMembers: 1014, runtime, fixture: JSON.parse(records.get(references[5]).body) }, null, 2));
    for (const name of ['src/commands/node/types.ts', 'src/commands/network/types.ts', 'src/fs/readonly.ts', 'src/index.ts', 'src/shell/parser.ts']) {
      const row = inputs.find(item => item.path === name);
      if (row) { const text = objects.get(row.blob).body.toString(); console.log('SOURCE_VIEW', name, row.blob, name.endsWith('parser.ts') ? text.slice(0,5000) : text.slice(0,18000)); }
    }
    console.log('INHERITED_PREP_SOURCE\n' + records.get(references[4]).body.toString().slice(0,18000));
    console.log('INHERITED_RUN_MAP\n' + records.get(references[6]).body.toString().split('\n').filter(line => /harnessMap|cohort\(|\.mjs'|\.mjs"/.test(line)).join('\n'));
  } else if (mode === '--details') {
    const source = JSON.parse(local(path.join(own, 'SOURCE.json')));
    const paths = ['src/fs/readonly/index.ts', 'src/commands/node/index.ts', 'src/commands/git/diff.ts'];
    const rows = paths.map(name => source.inputs.find(row => row.path === name)).filter(Boolean);
    const records = blobs(rows.map(row => row.blob));
    for (const row of rows) { const object = records.get(row.blob); assert.equal(object.sha256, row.sha256); console.log('FILE', row.path, object.body.toString().slice(0,18000)); }
  } else {
    const fixturePaths = [
      'tests/compatibility/bash-conditional-author-20260829/redirections-v3.mjs',
      'tests/compatibility/bash-redirection-author-20260829/CASES.json',
      'tests/compatibility/bash-redirection-author-20260829/close-observer.mjs',
      'tests/compatibility/bash-strict-mode-author-20260829/strict.mjs',
      'tests/compatibility/bash-strict-mode-design-20260829/CASES.json',
      'tests/compatibility/bash-conditional-author-20260829/conditional-v4.mjs',
      'tests/compatibility/bash-strict-extension-author-20260829/extension-v2.mjs',
      'tests/compatibility/bash-strict-extension-design-20260829/CASES.json',
      'tests/integration/coherent78-arrays-author-20260828/arrays.mjs',
      'tests/integration/coherent78-arrays-author-20260828/ARRAY-CASES.json',
      'tests/compatibility/bash-strict-extension-author-20260829/n14-v4/n14.mjs',
      'tests/integration/git-public-20260829/resources.mjs',
      'tests/integration/git-public-20260829/loader.mjs',
      'tests/integration/git-public-20260829/names.mjs',
    ];
    const records = blobs(fixturePaths.map(name => n14 + ':' + name));
    put('RETAINED-FIXTURES.json', [...records.values()].map(({ body, ...row }, index) => ({ ...row, path: fixturePaths[index], role: 'READONLY_INHERITED_FIXTURE; UNRUN_ON_NEW_COMPOSITION' })));
    const inherited = JSON.parse(local(path.join(own, 'INHERITED-TOOL-BINDINGS.json'))), toolRows = {};
    for (const name of ['typescript','npm','@types/node','undici-types']) {
      const root = fs.realpathSync(inherited[name].origin), rows = []; let bytesTotal = 0, packageBody;
      async function visit(directory, prefix = '') {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
          const relative = prefix ? prefix + '/' + entry.name : entry.name, filename = path.join(directory, entry.name), stat = fs.lstatSync(filename);
          assert.ok(entry.name !== 'AGENTS.md'); assert.ok(rows.length < 4096);
          if (stat.isSymbolicLink()) { const target = fs.readlinkSync(filename), resolved = fs.realpathSync(filename); assert.ok(resolved.startsWith(root + path.sep)); rows.push({ path: relative, type: 'symlink', target, resolvedRelative: path.relative(root, resolved) }); }
          else if (stat.isDirectory()) await visit(filename, relative);
          else {
            assert.ok(stat.isFile() && stat.size <= 16777216); const digest = createHash('sha256'); let count = 0; const chunks = relative === 'package.json' ? [] : null;
            for await (const chunk of fs.createReadStream(filename)) { count += chunk.length; assert.ok(count <= stat.size); digest.update(chunk); if (chunks) chunks.push(chunk); }
            const after = fs.lstatSync(filename); assert.equal(after.ino, stat.ino); assert.equal(after.mtimeMs, stat.mtimeMs); assert.equal(count, stat.size);
            bytesTotal += count; assert.ok(bytesTotal <= 134217728); const hash = digest.digest('hex');
            rows.push({ path: relative, type: 'file', mode: stat.mode & 0o777, bytes: count, sha256: hash });
            if (chunks) { packageBody = Buffer.concat(chunks, count); assert.equal(sha(packageBody), hash); }
          }
        }
      }
      await visit(root); assert.ok(packageBody); assert.equal(JSON.parse(packageBody).version, inherited[name].version);
      toolRows[name] = { origin: inherited[name].origin, resolvedRoot: root, version: inherited[name].version, rows, bytes: bytesTotal, inventorySha256: sha(Buffer.from(JSON.stringify(rows))), historicalCanonicalInventorySha256: inherited[name].inventorySha256, qualification: 'Fresh byte-path object-row inventory; historical array-row digest retained separately, not claimed identical serialization.' };
    }
    put('TOOLS.json', { ...tools, packages: toolRows, role: 'SOURCE_DATA_HASHING_ONLY_NO_TOOL_EXECUTION_EXCEPT_PINNED_NODE_GIT_METADATA', osBoundary: 'Inherited admitted host/Node profile; no full dynamic image attestation.' });
    for (const filename of ['workflows.mjs','workflow-entry.mjs','admission.mjs']) {
      const prefix = path.join(capture, 'syntax-' + filename), stdout = fs.openSync(prefix + '.stdout','wx'), stderr = fs.openSync(prefix + '.stderr','wx'); let result;
      try { result = spawnSync(tools.node.path, ['--check', path.join(own, filename)], { stdio: ['ignore',stdout,stderr], timeout: 30000, env: { PATH: path.dirname(tools.node.path), HOME: '/tmp' } }); }
      finally { fs.closeSync(stdout); fs.closeSync(stderr); }
      children++; note({ role: 'SYNTAX_ONLY_NO_MODULE_EVALUATION', filename, pid: result.pid, status: result.status, signal: result.signal }); assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
    }
    const { admitFile, consumeAdmitted } = await import('./admission.mjs');
    const { gzipSync, gunzipSync } = await import('node:zlib');
    const dataRoot = path.join(capture, 'data-controls'); fs.mkdirSync(dataRoot);
    const plain = Buffer.from('{"value":1}'), filename = path.join(dataRoot, 'plain.data'); fs.writeFileSync(filename, plain, { flag: 'wx' });
    const identity = { bytes: plain.length, sha256: sha(plain) }, controls = []; let callbacks = 0;
    function control(id, action) { action(); controls.push({ id, pass: true, role: 'DATA_ONLY_NO_PRODUCT' }); }
    control('A01-same-buffer', () => assert.equal(consumeAdmitted(filename, identity, 1024, buffer => { callbacks++; return JSON.parse(buffer).value; }), 1));
    for (const [id, expected, cap] of [['A02-hash-before-consumer',{...identity,sha256:'0'.repeat(64)},1024],['A03-exact-size',{...identity,bytes:plain.length+1},1024],['A04-cap',identity,1]]) control(id, () => { const before = callbacks; assert.throws(() => consumeAdmitted(filename, expected, cap, () => callbacks++)); assert.equal(callbacks,before); });
    const link = path.join(dataRoot,'link.data'); fs.symlinkSync('plain.data',link);
    control('A05-link-type', () => assert.throws(() => admitFile(link,identity,1024)));
    control('A06-directory-type', () => assert.throws(() => admitFile(dataRoot,identity,1024)));
    control('A07-missing', () => assert.throws(() => admitFile(path.join(dataRoot,'absent'),identity,1024)));
    control('A08-no-reread', () => { const authenticated = admitFile(filename,identity,1024); fs.writeFileSync(filename,'{"value":2}'); assert.equal(JSON.parse(authenticated).value,1); assert.throws(() => admitFile(filename,identity,1024)); fs.writeFileSync(filename,plain); });
    const zipped = gzipSync(Buffer.alloc(1024,65)), zippedPath = path.join(dataRoot,'compressed.data'); fs.writeFileSync(zippedPath,zipped,{flag:'wx'}); const zipIdentity = {bytes:zipped.length,sha256:sha(zipped)};
    control('A09-hash-before-inflate', () => assert.equal(consumeAdmitted(zippedPath,zipIdentity,1024,buffer => gunzipSync(buffer,{maxOutputLength:2048})).length,1024));
    control('A10-bad-hash-no-inflate', () => { let inflated=false; assert.throws(() => consumeAdmitted(zippedPath,{...zipIdentity,sha256:'0'.repeat(64)},1024,buffer => {inflated=true;return gunzipSync(buffer);})); assert.equal(inflated,false); });
    control('A11-decoded-bound', () => assert.throws(() => consumeAdmitted(zippedPath,zipIdentity,1024,buffer => gunzipSync(buffer,{maxOutputLength:8}))));
    control('A12-metadata-shape', () => assert.throws(() => admitFile(filename,{...identity,sha256:'bad'},1024)));
    put('ADMISSION-CONTROLS.json', { controls, productExecutions:0, nativeExecutions:0, decodeQualification:'Only harmless task-owned DATA; no product package inflated.' });
    const sourceBytes = local(path.join(own,'SOURCE.json')), source = JSON.parse(sourceBytes);
    const planned = { layouts:['source-built','installed','physically-moved'], retainedPerLayout:{unit1:48,unit2:50,conditional:67,extension:35,arrays:12}, retainedTotal:636, n14Separate:36, authorWorkflows:{engineFree:39,publicEngineSeparateGrant:15,totalFuture:54}, independentProposals:{engineFree:18,publicEngine:6,total:24,implementedHere:false}, unit2Rule:'All50 exact IDs/layout; collector rejects duplicate IDs; do not add a second Unit2 corpus.', node61AndPublic24:'Separate future engine regression recipes with exact version maps; not included in engine-free count or claimed executed.' };
    const files = fs.readdirSync(own).filter(name => /\.(mjs|sh|fixture|json|nul)$/.test(name) && !['EXECUTABLE-PRESEAL.json'].includes(name)).sort().map(name => { const body=local(path.join(own,name)); return {path:name,bytes:body.length,sha256:sha(body)}; });
    put('EXECUTABLE-PRESEAL.json', { role:'SOURCE_DATA_PREPARATION_ONLY_ACTUAL_GRANT_REQUIRED', date:'2026-08-29', sourceTree:source.computedTree, sourceManifestSha256:sha(sourceBytes), files, predictedPackageMembers:1014, actualPackageSha256:null, actualExecutions:0, planned, proposedActual:{seconds:2700,knownOSStarts:112,peak:4,captureBytes:201326592,workingBytes:1073741824,caseSeconds:30,buildSeconds:120,loaderAdmissions:40,regexWorkers:8,publicEngineWorkers:0,privateInputs:0}, admission:'same authenticated Buffer after regular-file/exact-size/bounded-read/SHA256 before JSON/inflate/import; no reread; each actual phase repeats contemporary checks', runAuthority:'NONE. Do not execute workflow-entry or any build/install/product under preparation grant.' });
    console.log(JSON.stringify({ sourceTree:source.computedTree, sourceManifestSha256:sha(sourceBytes), controls:controls.length, syntaxChecks:3, toolEntries:Object.fromEntries(Object.entries(toolRows).map(([name,row])=>[name,row.rows.length])), planned, children, productExecutions:0 }));
  }
  note({ finished: new Date().toISOString(), children, closed: true, productExecutions: 0 });
} catch (error) {
  note({ failure: String(error?.stack ?? error), children }); process.exitCode = 1;
} finally { fs.closeSync(events); }
