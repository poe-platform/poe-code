import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const own = path.dirname(fileURLToPath(import.meta.url)), executor = path.join(path.dirname(own), 'candidate-753-review-executor-v2'), old = path.join(path.dirname(own), 'candidate-753-review-executor-v1');
const scratch = process.argv[2];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function read(file, maximum) {
  assert.match(file, /\.(json|mjs)$/); const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(file); new TextDecoder('utf8', { fatal: true }).decode(bytes); return bytes;
}
const preseal = JSON.parse(read(path.join(own, 'CONTROL-PRESEAL.json'), 32768));
for (const [name, expected] of Object.entries(preseal.files)) {
  assert.match(name, /^[A-Za-z0-9_.-]+\.(mjs|json|md|patch)$/); const filename = path.join(own, name), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024); assert.equal(stat.size, expected.bytes); assert.equal(stat.mode & 511, expected.mode);
  const digest = createHash('sha256'); for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) digest.update(chunk); assert.equal(digest.digest('hex'), expected.sha256);
}
const metadata = JSON.parse(read(path.join(own, 'INPUT-METADATA.json'), 16384));
function historical(name) {
  const record = metadata.find(entry => entry.name === name); assert.ok(record);
  const bytes = read(path.join(old, name), record.bytes); assert.equal(bytes.length, record.bytes); assert.equal(sha(bytes), record.sha256); return JSON.parse(bytes);
}
const { CAP, encode, decode, makeAuthority, serialize, parse, measure, frameSize, publishRuntimePair } = await import('../candidate-753-review-executor-v2/manifest.mjs');
const pkg = historical('PACKAGE-INVENTORY.json'), binding = historical('BINDINGS.json');
const runtime = historical('RUNTIME-SEAL.json');
const frozenVariants = historical('VARIANTS.json');
const authority = makeAuthority(pkg, binding.selectedInputs, binding.candidate, frozenVariants);
const results = [];
async function test(id, body) { try { const data = await body(); results.push({ id, status: 'PASS', data: data ?? null }); } catch (error) { results.push({ id, status: 'FAIL', error: { name: error.name, message: error.message } }); } }
const clone = value => structuredClone(value);
let packet, compact;
await test('D01-full-historical-roundtrip', () => { packet = encode(runtime, pkg, binding.selectedInputs, authority); compact = serialize(packet); assert.deepEqual(decode(parse(compact), authority), runtime); assert.equal(runtime.graphBindings.length, 30); assert.equal(runtime.jobs.length, 51); return { originalBytes: 22330550, compactBytes: compact.length, catalogs: packet.catalogs.length, graphs: 30, jobs: 51, packageFiles: 882, inputRows: 274 }; });
assert.ok(packet && compact, 'integrity dependency STOP');
await test('D02-v2-exact-phase-overlay-membership', () => { const reconstructed = decode(packet, authority); for (let index = 0; index < 30; index++) assert.deepEqual(reconstructed.graphBindings[index], runtime.graphBindings[index]); assert.equal(packet.catalogs.filter(entry => entry.body.kind === 'overlay').length, 30);
assert.deepEqual(reconstructed.graphBindings.map(row=>row.id).sort(), frozenVariants.map(row=>row.id).sort());
assert.deepEqual(Object.keys(authority.graphs).filter(id=>id!=='base').sort(), frozenVariants.map(row=>row.id).sort());
return { physicalGraphs: 30, distinctOverlayBodies: 30, exactIds: frozenVariants.map(row=>row.id).sort() }; });
await test('D03-job-writer-reader', () => { let count = 0; for (const entry of runtime.jobs.filter(entry => entry.job)) { const encoded = serialize(encode(entry.job, pkg, binding.selectedInputs, authority)); assert.deepEqual(decode(parse(encoded), authority), entry.job); count++; } return { jobs: count }; });
await test('D04-serialization-minus-at-plus', () => { assert.equal(serialize('a'.repeat(CAP - 4)).length, CAP - 1); assert.equal(serialize('a'.repeat(CAP - 3)).length, CAP); let allocations = 0; const from = Buffer.from; Buffer.from = function(...args) { allocations++; return Reflect.apply(from, this, args); }; try { assert.throws(() => serialize('a'.repeat(CAP - 2)), /JSON byte cap/); assert.equal(allocations, 0); } finally { Buffer.from = from; } });
await test('D05-framing-minus-at-plus', () => { const base = { oid: '1'.repeat(40), kind: 'blob', bytes: CAP - 56 }; assert.equal(frameSize([base]), CAP); assert.equal(frameSize([{ ...base, bytes: base.bytes - 1 }]), CAP - 1); assert.throws(() => frameSize([{ ...base, bytes: base.bytes + 1 }]), /framed batch cap/); assert.throws(() => frameSize([base], CAP - 1), /framed batch cap/); assert.throws(() => frameSize([base, base]), /duplicate object/); });
await test('D06-header-LF-multiple-records', () => { const records = [{ oid:'1'.repeat(40),kind:'commit',bytes:277 },{ oid:'2'.repeat(40),kind:'blob',bytes:compact.length },{ oid:'3'.repeat(40),kind:'blob',bytes:47367 }]; const exact = records.reduce((sum, row) => sum + Buffer.byteLength(`${row.oid} ${row.kind} ${row.bytes}\n`) + row.bytes + 1, 0); assert.equal(frameSize(records), exact); assert.throws(() => frameSize(records, exact - 1)); return { framedBytes: exact }; });
for (const [id, mutate] of [
  ['D07-dangling', value => { value.payload.packageInventory.$catalog = '0'.repeat(64); }],
  ['D08-external', value => { value.payload.packageInventory.$catalog = 'file:///tmp/unbound'; }],
  ['D09-duplicate-record', value => { value.catalogs.splice(1, 0, value.catalogs[0]); }],
  ['D10-corrupt-catalog', value => { value.catalogs[0].body.extra = true; }],
  ['D11-missing-record', value => { value.catalogs.splice(0, 1); }],
  ['D12-wrong-authority', value => { value.authority.candidate = '0'.repeat(40); }],
  ['D13-extra-envelope', value => { value.extra = true; }]
]) await test(id, () => { const value = clone(packet); mutate(value); assert.throws(() => decode(value, authority)); });
function rewriteRecord(value, record, body) {
  const previous = record.id; record.body = body; record.id = sha(serialize(body));
  function update(item) { if (item && typeof item === 'object') { if (item.$catalog === previous) item.$catalog = record.id; for (const entry of Object.values(item)) update(entry); } }
  update(value.payload); value.catalogs.sort((left,right) => left.id.localeCompare(right.id));
}
for (const [id, mutate] of [
  ['D14-self-overlay', (body, record) => { body.base = record.id; }],
  ['D15-mode-overlay', body => { body.replacements[0][1].mode = 511; }],
  ['D16-extra-overlay-path', body => { body.replacements[0][0] = 'dist/unbound.js'; }],
  ['D17-duplicate-overlay', body => { body.replacements.push(body.replacements[0]); }],
  ['D18-wrong-result', body => { body.result = '0'.repeat(64); }]
]) await test(id, () => { const value = clone(packet), record = value.catalogs.find(entry => entry.body.kind === 'overlay'); const body = clone(record.body); mutate(body, record); rewriteRecord(value, record, body); assert.throws(() => decode(value, authority)); });
await test('D19-extras-authenticated-but-unused', () => { const value = clone(packet), body = { kind: 'inventory', rows: [] }; value.catalogs.push({ id: sha(serialize(body)), body }); value.catalogs.sort((left,right) => left.id.localeCompare(right.id)); assert.throws(() => decode(value, authority), /unreferenced/); });
await test('D20-canonical-duplicate-truncation', () => { assert.throws(() => parse(Buffer.from('{"x":1,"x":2}\n'))); assert.throws(() => parse(compact.subarray(0, -1))); assert.throws(() => parse(Buffer.concat([compact, Buffer.from('\n')]))); assert.throws(() => parse(Buffer.from([0xff]))); });
await test('D21-own-data-falsy-and-unicode', () => { const value = { a: 0, b: null, c: false, d: '🙂\ud800\r\n\t"\\' }; assert.deepEqual(parse(serialize(value)), value); let getters = 0; assert.throws(() => measure(Object.defineProperty({}, 'x', { get() { getters++; return 1; } }))); assert.equal(getters, 0); const cyclic = {}; cyclic.x = cyclic; assert.throws(() => measure(cyclic)); assert.throws(() => measure([, 1])); });
await test('D22-full-membership-refusal', () => { const missing = clone(pkg); delete missing['README.md']; assert.throws(() => encode(runtime, missing, binding.selectedInputs, authority)); const wrong = clone(pkg); wrong['README.md'].sha256 = '0'.repeat(64); assert.throws(() => encode(runtime, wrong, binding.selectedInputs, authority)); });
await test('A01-unauthorized-same-shape-graph', () => {
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
const stubText = 'globalThis.manifestStubEvaluations = (globalThis.manifestStubEvaluations ?? 0) + 1; export const value = 1;\n';
const stubName = 'dist/commands/apply-patch/index.js', wrongName = 'dist/commands/apply-patch/apply.js';
fs.mkdirSync(path.join(scratch, 'dist/commands/apply-patch'), { recursive: true });
for (const name of [stubName, wrongName, 'unbound.js']) fs.writeFileSync(path.join(scratch, name), stubText, { flag: 'wx', mode: 0o644 });
const stubPackage = clone(pkg); stubPackage[stubName] = {kind:'file',mode:420,bytes:Buffer.byteLength(stubText),sha256:sha(stubText)};
stubPackage[wrongName] = {...stubPackage[stubName],sha256:'0'.repeat(64)};
const stubAuthority = makeAuthority(stubPackage, binding.selectedInputs, 'SYNTHETIC-NOT-PRODUCTION');
const stubJob = { schema:'AP753-job-v1', consumer:scratch, graphs:[{id:'base',product:scratch,manifest:stubPackage}],harness:{} };
await test('S01-actual-loader-packet-guards', async () => {
  const { installPacketLoader } = await import('../candidate-753-review-executor-v2/loader.mjs');
  const encoded = encode(stubJob, stubPackage, binding.selectedInputs, stubAuthority);
  assert.throws(() => installPacketLoader(encoded, authority));
  const { loads } = installPacketLoader(parse(serialize(encoded)), stubAuthority); globalThis.manifestStubEvaluations = 0;
  await assert.rejects(import(pathToFileURL(path.join(scratch, wrongName)).href)); assert.equal(globalThis.manifestStubEvaluations, 0);
  await assert.rejects(import(pathToFileURL(path.join(scratch, 'unbound.js')).href)); assert.equal(globalThis.manifestStubEvaluations, 0);
  const result = await import(pathToFileURL(path.join(scratch, stubName)).href); assert.equal(result.value, 1); assert.equal(globalThis.manifestStubEvaluations, 1); assert.equal(loads.length, 1);
  return { evaluations:1, refusals:3, physicallyStagedProductFiles:0, syntheticOnly:true, loaded:loads };
});
fs.writeFileSync(path.join(scratch, 'NORMALIZED-HISTORICAL.json'), compact, { flag: 'wx' });
console.log(JSON.stringify({ schema:'manifest-controls-v1', sourcePresealSha256:sha(read(path.join(own,'CONTROL-PRESEAL.json'),32768)), results, pass:results.filter(row=>row.status==='PASS').length, fail:results.filter(row=>row.status==='FAIL').length, normalizedSha256:sha(compact), historicalRawReconstruction:false, productEvaluations:0 }));
process.exitCode = results.some(row=>row.status==='FAIL') ? 1 : 0;
