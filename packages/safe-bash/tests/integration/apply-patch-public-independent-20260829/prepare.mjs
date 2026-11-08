import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { regular, put, sha, object, census, verify, compose, inventory, members } from '../coherent78-arrays-independent-20260828/common.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const author = 'tests/integration/apply-patch-public-20260829';
const read = name => regular(path.join(repo, name));
const json = name => JSON.parse(read(name));
const source = json(author + '/SOURCE-v2.json'), previous = json(author + '/SOURCE.json');
assert.equal(sha(read(author + '/SOURCE-v2.json')), 'da431477e0cf1072370b8e55cdebce80e33dbf9cac8471656854572b363b9d0d');
assert.equal(source.computedTree, '7fde32264d757ef856acf3ae92c8581b4a294341');
assert.deepEqual(source.inputs, previous.inputs); assert.equal(source.inputs.length, 278);
const base = json('tests/integration/coherent78-arrays-independent-20260828/AUTHENTICATION.json');
assert.equal(base.derived, source.base); assert.equal(base.selectedSource.length, 272);
const directory = path.join(here, 'PREPARED'); assert.ok(!fs.existsSync(directory)); fs.mkdirSync(directory);
const requests = new Map();
function request(row) {
  assert.match(row.revision, /^[a-f0-9]{40}$/); assert.match(row.path, /^[A-Za-z0-9_.@/-]+$/); assert.ok(row.path.split('/').every(part => part && part !== '..' && part !== 'AGENTS.md'));
  requests.set(row.revision + ':' + row.path, row);
}
for (const row of [...source.inputs, ...source.fixtures, ...source.documentation, previous.fixtureCorrection?.previous].filter(Boolean)) request(row);
request(source.fixtureCorrection.previous);
const harness = [
  ...['SOURCE.json','SOURCE-v2.json','public.mjs','public-v2.mjs','names.mjs','consumer.ts.fixture','FIXTURE-v2.md','HANDOFF.md','results-v1/PACKAGE.tgz.base64'].map(name => ({ from: author + '/' + name, to: name })),
  { from: 'tests/integration/coherent78-arrays-independent-20260828/AUTHENTICATION.json', to: 'base-auth.json' },
  ...['arrays.mjs','ARRAY-CASES.json'].map(name => ({ from: 'tests/integration/coherent78-arrays-author-20260828/' + name, to: name })),
  ...['probe.mjs','names.mjs','CASES.json','CASES-v2-overlay.json'].map(name => ({ from: 'tests/integration/coherent78-shell-author-20260828/' + name, to: 'coherence/' + name })),
  ...['tests/commands/stream-format/helpers.ts','tests/commands/split/helpers.ts'].map(name => ({ from: name, to: name })),
];
for (const row of harness) { const bytes = read(row.from); row.bytes = bytes.length; row.sha256 = sha(bytes); request({ path: row.from, revision: 'a820ed6c09bc02741718598764dc842a17040669', bytes: bytes.length, sha256: sha(bytes) }); }
const git = '/Library/Developer/CommandLineTools/usr/bin/git';
function binary(filename) { const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 256 * 1024 * 1024); const hash = createHash('sha256'), fd = fs.openSync(filename, 'r'), chunk = Buffer.alloc(1024 * 1024); try { for (;;) { const bytes = fs.readSync(fd, chunk, 0, chunk.length, null); if (!bytes) break; hash.update(chunk.subarray(0, bytes)); } } finally { fs.closeSync(fd); } return { path: filename, bytes: stat.size, mode: stat.mode & 0o777, sha256: hash.digest('hex') }; }
const node = binary(base.node.origin); assert.equal(node.sha256, base.node.sha256);
const gitBinding = binary(git), expressions = [...requests.keys()];
const args = ['-c','gc.auto=0','-c','maintenance.auto=false','-c','core.fsmonitor=false','cat-file','--batch'];
const started = Date.now();
const result = spawnSync(git, args, { cwd: repo, env: { PATH:'',HOME:directory,TMPDIR:directory,LC_ALL:'C',TZ:'UTC',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0' }, input: expressions.join('\n') + '\n', timeout:60000, maxBuffer:32*1024*1024 });
put(path.join(directory, 'GIT-RAW.json'), JSON.stringify({ executable:gitBinding,args,expressions,pid:result.pid,status:result.status,signal:result.signal,error:result.error?.message,elapsedMs:Date.now()-started,stdout:result.stdout.toString('base64'),stderr:result.stderr.toString('base64') }) + '\n');
assert.equal(result.status,0); assert.equal(result.signal,null); assert.equal(result.stderr.length,0); assert.equal(result.error,undefined);
const blobs = new Map(), authenticated = []; let offset = 0;
for (const expression of expressions) {
  const row = requests.get(expression), end = result.stdout.indexOf(10,offset), header = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(result.stdout.subarray(offset,end).toString()); assert.ok(header);
  const length = Number(header[2]), bytes = result.stdout.subarray(end+1,end+1+length); assert.equal(result.stdout[end+1+length],10); offset=end+2+length;
  assert.equal(length,row.bytes); assert.equal(sha(bytes),row.sha256); assert.equal(object('blob',bytes),header[1]); if(row.blob)assert.equal(header[1],row.blob);
  blobs.set(expression,bytes); authenticated.push({expression,blob:header[1],bytes:length,sha256:sha(bytes)});
}
assert.equal(offset,result.stdout.length);
const get = row => blobs.get(row.revision + ':' + row.path);
for (const row of source.inputs) put(path.join(directory,'source',row.path),get(row),parseInt(row.mode,8)&0o777);
for (const row of source.fixtures) put(path.join(directory,'fixtures',row.path),get(row));
for (const row of harness) put(path.join(directory,'harness',row.to),blobs.get('a820ed6c09bc02741718598764dc842a17040669:'+row.from));
const baseRows = new Map(base.selectedSource.map(row=>[row.path,row]));
const added = [], changed = [];
for (const row of source.inputs) { const prior=baseRows.get(row.path); if(!prior)added.push(row.path);else if(prior.blob!==row.blob)changed.push(row.path); }
assert.deepEqual(added.sort(),source.module.map(row=>row.path).sort());assert.deepEqual(changed.sort(),source.publicRows.map(row=>row.path).sort());
assert.ok(base.selectedSource.every(row=>source.inputs.some(next=>next.path===row.path)));
const trees = new Map(); for(const row of [...source.ancestorTrees,...source.fetchedTrees,...source.reconstructedTrees]) { const bytes=Buffer.from(row.base64,'base64');assert.equal(object('tree',bytes),row.oid);trees.set(row.oid,bytes); }
assert.equal(compose(trees,source.base,[...source.module,...source.publicRows,...source.fixtures,...source.documentation]),source.computedTree);
const oldPublic=blobs.get('a820ed6c09bc02741718598764dc842a17040669:'+author+'/public.mjs').toString(),newPublic=blobs.get('a820ed6c09bc02741718598764dc842a17040669:'+author+'/public-v2.mjs').toString();
const start="await record('P05-replace-global-true'",stop="await record('P06-invalid-options-atomic'";
assert.equal(oldPublic.slice(0,oldPublic.indexOf(start)),newPublic.slice(0,newPublic.indexOf(start)));assert.equal(oldPublic.slice(oldPublic.indexOf(stop)),newPublic.slice(newPublic.indexOf(stop)));
const oldFixture=get(source.fixtureCorrection.previous).toString(),newFixture=get(source.fixtures.find(row=>row.path===source.fixtureCorrection.previous.path)).toString();
assert.equal(newFixture,oldFixture.replace('"timeout"]','"timeout", "apply_patch"]'));
const registry=source.inputs.find(row=>row.path==='src/contracts/command.ts');assert.ok(get(registry).toString().includes('Object.freeze({ ...command, name, execute })'));
const tar=Buffer.from(read(author+'/results-v1/PACKAGE.tgz.base64').toString().trim(),'base64');assert.equal(sha(tar),'643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd');assert.equal(tar.length,814632);
const packageEntries=inventory(tar),oldEntries=base.packageEntries;assert.equal(Object.keys(packageEntries).length,898);
const packageAdded=Object.keys(packageEntries).filter(name=>!oldEntries[name]),packageChanged=Object.keys(oldEntries).filter(name=>packageEntries[name]?.sha256!==oldEntries[name].sha256);assert.equal(packageAdded.length,24);assert.equal(packageChanged.length,10);assert.ok(Object.keys(oldEntries).every(name=>packageEntries[name]));assert.ok(packageAdded.every(name=>name.startsWith('dist/commands/apply-patch/')));
const packageJson=JSON.parse(members(tar).get('package.json').bytes);assert.deepEqual(packageJson.dependencies??{},{});assert.equal(packageJson.exports['./commands/apply-patch'].import,'./dist/commands/apply-patch/index.js');
put(path.join(directory,'PACKAGE.tgz'),tar);
for(const tool of Object.values(base.tools))verify({root:tool.root,entries:tool.entries});
const authentication={candidate:source.computedTree,sourceManifestSha256:sha(read(author+'/SOURCE-v2.json')),base:source.base,module:source.moduleCommit,integration:source.integrationCommit,selected:source.inputs,authenticated,added,changed,packageAdded,packageChanged,packageEntries,packageSha256:sha(tar),node,git:gitBinding,tools:base.tools,sourceRoot:path.join(directory,'source'),sourceCensus:census(path.join(directory,'source')),preparedCensus:census(directory),authorCensus:census(path.join(repo,author)),harness,fixtureCorrections:{publicOnly:'P05',maintainedOnly:'append apply_patch to literal timeout tail',executed:false},gitChildren:1};
put(path.join(here,'AUTHENTICATION.json'),JSON.stringify(authentication,null,2)+'\n');
console.log(JSON.stringify({candidate:source.computedTree,inputs:source.inputs.length,stored:authenticated.length,package:sha(tar),members:Object.keys(packageEntries).length,changed,gitPid:result.pid}));
