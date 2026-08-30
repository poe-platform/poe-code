import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const own=path.dirname(fileURLToPath(import.meta.url)),review=path.dirname(own),repository=path.resolve(own,'../../../..');
const prior=path.join(review,'manifest-representation-v3'),executor=path.join(review,'candidate-753-review-executor-v2');
function read(directory,name,maximum=450000){assert.match(name,/^[A-Za-z0-9_.-]+\.(mjs|json)$/);const filename=path.join(directory,name),stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);return new TextDecoder('utf8',{fatal:true}).decode(fs.readFileSync(filename));}
const sourceSeal=JSON.parse(read(prior,'CONTROL-PRESEAL.json',32768));
function bound(name){const value=read(prior,name),entry=sourceSeal.files[name];assert.ok(entry);assert.equal(Buffer.byteLength(value),entry.bytes);assert.equal(createHash('sha256').update(value).digest('hex'),entry.sha256);assert.equal(fs.lstatSync(path.join(prior,name)).mode&511,entry.mode);return value;}
function replace(value,before,after){assert.equal(value.split(before).length,2,before);return value.replace(before,after);}
const names=['common.mjs','path-bytes.mjs','composition.mjs','package-data.mjs','dispatch.mjs','legacy.mjs','s54.mjs','variants.mjs','guard.mjs','build.mjs','BINDINGS.json','PACKAGE-INVENTORY.json','JOBS.json','VERSIONED-ROWS.json','VARIANTS.json','loader.mjs','bootstrap.mjs'];
const bodies=Object.fromEntries(names.map(name=>[path.join(executor,name),bound(name)]));
let manifest=bound('manifest.mjs');
manifest=replace(manifest,"export const SCHEMA = 'AP753-catalogs-v2';","export const SCHEMA = 'AP753-catalogs-v3';");
const first=manifest.indexOf('export function makeAuthority('),last=manifest.indexOf('export function encode(',first);assert.ok(first>0&&last>first);
manifest=manifest.slice(0,first)+`export function makeAuthority(packageInventory, inputs, candidate, variants = []) {
  measure(packageInventory); measure(inputs); measure(variants);
  const entries = rows(packageInventory);
  assert.equal(entries.filter(([, entry]) => entry.kind === 'file').length, 882); assert.equal(entries.length, 926);
  const packageId = catalogId({ kind: 'inventory', rows: entries });
  const graphs = { base: packageId };
  assert.ok(Array.isArray(variants) && variants.length <= 30);
  for (const variant of variants) {
    assert.match(variant.id, /^[A-Za-z0-9-]+$/); assert.ok(!Object.hasOwn(graphs, variant.id), 'unique approved graph');
    const changed = { ...packageInventory };
    assert.ok(Object.keys(variant.bindings).length > 0 && Object.keys(variant.bindings).length <= 6);
    for (const [name, entry] of Object.entries(variant.bindings)) {
      assert.match(name, /^dist\\/commands\\/apply-patch\\/(apply|index|parser|matcher|shared|options)\\.js$/);
      assert.ok(Object.hasOwn(changed, name)); fields(entry, ['mode', 'bytes', 'sha256']); assert.equal(entry.mode, changed[name].mode);
      changed[name] = { kind: 'file', ...entry };
    }
    const modified = rows(changed), replacements = modified.filter((pair, index) => !serialize(pair).equals(serialize(entries[index])));
    assert.ok(replacements.length > 0 && replacements.length <= 6);
    graphs[variant.id] = catalogId({ kind: 'overlay', base: packageId, replacements, result: catalogId({ kind: 'inventory', rows: modified }) });
  }
  return { schema: SCHEMA, candidate, packageId, inputsId: catalogId({ kind: 'inputs', rows: inputRows(inputs) }), graphs };
}
function transform(value, catalog, authority, decoding, key = '', parent) {
  if (['manifest', 'packageInventory', 'sourceBefore', 'sourceAfter'].includes(key)) {
    if (key === 'manifest') {
      assert.ok(parent && typeof parent.id === 'string' && Object.hasOwn(authority.graphs, parent.id), 'approved graph ID');
      if (decoding) { fields(value, ['$catalog']); assert.equal(value.$catalog, authority.graphs[parent.id], 'approved graph catalog identity'); }
    }
    const result = catalog(value);
    if (key === 'manifest' && !decoding) assert.equal(result.$catalog, authority.graphs[parent.id], 'approved graph catalog identity');
    return result;
  }
  if (key === 'consumerInventories') return Object.fromEntries(Object.entries(value).map(([layout, inventory]) => [layout, catalog(inventory)]));
  if (Array.isArray(value)) return value.map(item => transform(item, catalog, authority, decoding));
  if (value !== null && typeof value === 'object') {
    assert.ok(!Object.hasOwn(value, '$catalog'), 'reserved reference outside inventory');
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, transform(entry, catalog, authority, decoding, name, value)]));
  }
  return value;
}
export function publishRuntimePair(build, runtime, captureRemaining, publish) {
  assert.equal(typeof publish, 'function');
  const buildBytes = measure(build), runtimeBytes = measure(runtime);
  const framedBytes = frameSize([{ oid: '0'.repeat(40), kind: 'blob', bytes: buildBytes }, { oid: '1'.repeat(40), kind: 'blob', bytes: runtimeBytes }, { oid: '2'.repeat(40), kind: 'commit', bytes: 65536 }], captureRemaining);
  assert.ok(buildBytes + runtimeBytes + framedBytes <= captureRemaining, 'publication plus framed capture reservation');
  const buildBuffer = serialize(build), runtimeBuffer = serialize(runtime);
  publish('BUILD-RECEIPT.json', buildBuffer); publish('RUNTIME-SEAL.json', runtimeBuffer);
  return { buildBytes, runtimeBytes, framedBytes, commitPayloadReservation: 65536 };
}
`+manifest.slice(last);
manifest=replace(manifest,"measure(authority); assert.ok(serialize(makeAuthority(packageInventory, inputs, authority.candidate)).equals(serialize(authority)), 'exact authority');","measure(authority); fields(authority, ['schema', 'candidate', 'packageId', 'inputsId', 'graphs']);\n  const expected = makeAuthority(packageInventory, inputs, authority.candidate);\n  for (const key of ['schema', 'candidate', 'packageId', 'inputsId']) assert.equal(authority[key], expected[key]);\n  assert.equal(authority.graphs.base, expected.packageId);");
manifest=replace(manifest,'const data = transform(payload, inventory);','const data = transform(payload, inventory, authority, false);');
manifest=replace(manifest,'const result = transform(packet.payload, resolve);','const result = transform(packet.payload, resolve, authority, true);');
bodies[path.join(executor,'manifest.mjs')]=manifest;
let controller=bound('controller.mjs');
controller=replace(controller,"import { encode, serialize, measure, frameSize, CAP } from './manifest.mjs';","import { encode, serialize, frameSize, CAP, publishRuntimePair } from './manifest.mjs';");
const start=controller.indexOf("  put(path.join(own, 'BUILD-RECEIPT.json'),"),end=controller.indexOf('  runtimeBindings =',start);assert.ok(start>0&&end>start);
const buildLine=controller.slice(start,controller.indexOf('\n',start));assert.ok(buildLine.endsWith(', true);'));
const buildExpression=buildLine.slice("  put(path.join(own, 'BUILD-RECEIPT.json'), ".length,-', true);'.length);
controller=controller.slice(0,start)+`  const buildReceipt = ${buildExpression};
  const normalized = encode(runtimeSeal, actualPackage, binding.selectedInputs, authority);
  const publication = publishRuntimePair(buildReceipt, normalized, 128 * 1024 * 1024 - persisted - 16384, (name, bytes) => put(path.join(own, name), bytes, true));
  event({ kind: 'whole-runtime-publication-admitted', ...publication });
`+controller.slice(end);
bodies[path.join(executor,'controller.mjs')]=controller;
let controls=bound('controls.mjs');
controls=replace(controls,"const own = path.dirname(fileURLToPath(import.meta.url)), old =", "const own = path.dirname(fileURLToPath(import.meta.url)), executor = path.join(path.dirname(own), 'candidate-753-review-executor-v2'), old =");
controls=replace(controls,"const { CAP, encode, decode, makeAuthority, serialize, parse, measure, frameSize } = await import('./manifest.mjs');", "const { CAP, encode, decode, makeAuthority, serialize, parse, measure, frameSize, publishRuntimePair } = await import('../candidate-753-review-executor-v2/manifest.mjs');");
controls=replace(controls,'const authority = makeAuthority(pkg, binding.selectedInputs, binding.candidate);',"const frozenVariants = historical('VARIANTS.json');\nconst authority = makeAuthority(pkg, binding.selectedInputs, binding.candidate, frozenVariants);");
controls=replace(controls,"'D02-all-overlay-differences'","'D02-v2-exact-phase-overlay-membership'");
controls=replace(controls,"assert.equal(packet.catalogs.filter(entry => entry.body.kind === 'overlay').length, 10); return { physicalGraphs: 30, distinctOverlayBodies: 10 };","assert.equal(packet.catalogs.filter(entry => entry.body.kind === 'overlay').length, 30);\nassert.deepEqual(reconstructed.graphBindings.map(row=>row.id).sort(), frozenVariants.map(row=>row.id).sort());\nassert.deepEqual(Object.keys(authority.graphs).filter(id=>id!=='base').sort(), frozenVariants.map(row=>row.id).sort());\nreturn { physicalGraphs: 30, distinctOverlayBodies: 30, exactIds: frozenVariants.map(row=>row.id).sort() };");
controls=replace(controls,"id:'inert-stub-only'","id:'base'");
controls=replace(controls,"await import('./loader.mjs')","await import('../candidate-753-review-executor-v2/loader.mjs')");
const insertion=controls.indexOf('const stubText =');assert.ok(insertion>0);
controls=controls.slice(0,insertion)+`await test('A01-unauthorized-same-shape-graph', () => {
 const altered = clone(runtime); altered.graphBindings[0].manifest['README.md'].sha256 = '0'.repeat(64);
 assert.throws(()=>encode(altered,pkg,binding.selectedInputs,authority));
 const value=clone(packet), graph=value.payload.graphBindings[0], body={kind:'inventory',rows:[['only.js',{kind:'file',mode:420,bytes:0,sha256:sha('')}]]};
 const id=sha(serialize(body)); value.catalogs.push({id,body});value.catalogs.sort((left,right)=>left.id.localeCompare(right.id));graph.manifest={$catalog:id};
 assert.throws(()=>decode(value,authority),/approved graph catalog identity/);
});
await test('A02-changed-approved-overlay', () => { const value=clone(packet),record=value.catalogs.find(entry=>entry.body.kind==='overlay'),body=clone(record.body);body.replacements[0][1].sha256='0'.repeat(64);rewriteRecord(value,record,body);assert.throws(()=>decode(value,authority),/approved graph catalog identity/); });
await test('A03-graph-ID-mismatch', () => { const value=clone(packet);value.payload.graphBindings[0].id='unapproved';assert.throws(()=>decode(value,authority),/approved graph ID/);const other=clone(packet);other.payload.graphBindings[0].manifest=clone(other.payload.graphBindings[1].manifest);assert.throws(()=>decode(other,authority),/approved graph catalog identity/); });
await test('A04-buildreceipt-overcap-beforewrite', () => {let writes=0;assert.throws(()=>publishRuntimePair('x'.repeat(CAP),{},64*1024*1024,()=>writes++),/JSON byte cap/);assert.equal(writes,0);});
await test('A05-mixedbatch-beforewrite', () => {let writes=0;assert.throws(()=>publishRuntimePair('x'.repeat(CAP/2),'y'.repeat(CAP/2),64*1024*1024,()=>writes++),/framed batch cap/);assert.equal(writes,0);});
await test('A06-combinedcapture-beforewrite', () => {let writes=0;assert.throws(()=>publishRuntimePair({a:'x'},{b:'y'},128,()=>writes++));assert.equal(writes,0);});
await test('A07-publication-reader-positive', () => {const writes=[];const receipt=publishRuntimePair({kind:'build'},packet,64*1024*1024,(name,bytes)=>writes.push({name,bytes}));assert.deepEqual(writes.map(row=>row.name),['BUILD-RECEIPT.json','RUNTIME-SEAL.json']);assert.deepEqual(parse(writes[0].bytes),{kind:'build'});assert.deepEqual(decode(parse(writes[1].bytes),authority),runtime);assert.equal(receipt.runtimeBytes,writes[1].bytes.length);return receipt;});
await test('A08-executor-syntax-and-identity', async () => {
 const vm=await import('node:vm');let parsed=0;
 for(const [name,expected] of Object.entries(preseal.executorFiles)){const file=path.join(executor,name),stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,expected.bytes);assert.equal(stat.mode&511,expected.mode);const digest=createHash('sha256');for await(const chunk of fs.createReadStream(file,{highWaterMark:65536}))digest.update(chunk);assert.equal(digest.digest('hex'),expected.sha256);if(name.endsWith('.mjs')){const bytes=read(file,50000);new vm.SourceTextModule(new TextDecoder('utf8',{fatal:true}).decode(bytes),{identifier:name});parsed++;}}
 return {parsed,evaluations:0};
});
`+controls.slice(insertion);
bodies[path.join(own,'controls.mjs')]=controls;
let qualifier=bound('qualify.mjs');
qualifier=replace(qualifier,"const root = path.join(own, 'qualification-01');","const root = path.join(own, 'qualification-01');\nconst executor=path.join(path.dirname(own),'candidate-753-review-executor-v2');");
qualifier=replace(qualifier,"['--unhandled-rejections=strict','--max-old-space-size=256'","['--experimental-vm-modules','--unhandled-rejections=strict','--max-old-space-size=256'");
qualifier=replace(qualifier,"assert.equal(createHash('sha256').update(sealBytes).digest('hex'),process.argv[2]); receipt.sourceAuthenticated=true;", "for(const [name,expected] of Object.entries(seal.executorFiles)){assert.match(name,/^[A-Za-z0-9_.-]+\\.(mjs|json)$/);const filename=path.join(executor,name),info=fs.lstatSync(filename);assert.ok(info.isFile()&&!info.isSymbolicLink());assert.equal(info.size,expected.bytes);assert.equal(info.mode&511,expected.mode);const digest=createHash('sha256');for await(const chunk of fs.createReadStream(filename,{highWaterMark:65536}))digest.update(chunk);assert.equal(digest.digest('hex'),expected.sha256);}\n  assert.equal(createHash('sha256').update(sealBytes).digest('hex'),process.argv[2]); receipt.sourceAuthenticated=true;");
bodies[path.join(own,'qualify.mjs')]=qualifier;
bodies[path.join(own,'INPUT-METADATA.json')]=bound('INPUT-METADATA.json');
const patch='*** Begin Patch\n'+Object.entries(bodies).map(([file,body])=>'*** Add File: '+path.relative(repository,file)+'\n'+body.trimEnd().split('\n').map(line=>'+'+line).join('\n')+'\n').join('')+'*** End Patch\n';
assert.ok(Buffer.byteLength(patch)<=2*1024*1024);fs.writeFileSync(path.join(own,'SOURCE.patch'),patch,{flag:'wx'});
console.log(JSON.stringify({sourceOnly:true,files:Object.keys(bodies).length,patchBytes:Buffer.byteLength(patch),sha256:createHash('sha256').update(patch).digest('hex'),at:new Date().toISOString()}));
