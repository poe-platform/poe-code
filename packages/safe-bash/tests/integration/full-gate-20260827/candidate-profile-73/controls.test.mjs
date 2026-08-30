import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepare, verifyPrepared } from './prepare.mjs';

const candidate='c355751f36ca3fdbab8f888eaab30203c1bcd343';
const temporary=realpathSync(mkdtempSync(join(tmpdir(),'profile73-controls-')));
const original=join(temporary,'original');
const receipt=prepare(candidate,original);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function rewrite(directory,name,modify){
  const file=join(directory,name);let data=JSON.parse(readFileSync(file));modify(data);writeFileSync(file,JSON.stringify(data,null,2)+'\n');
  const receiptPath=join(directory,'RECEIPT.json'),current=JSON.parse(readFileSync(receiptPath));current.files[name]=hash(readFileSync(file));writeFileSync(receiptPath,JSON.stringify(current));
}
test.after(()=>rmSync(temporary,{recursive:true,force:true}));
test('explicit historical calibration has exact244 inputs,600 paths and unresolved11 inventory entries',()=>{
  assert.equal(receipt.cleanupInputs,244);assert.equal(receipt.canonicalFiles,600);assert.equal(receipt.blockers.unclassifiedMts.length,11);assert.equal(receipt.launched,false);
  assert.equal(receipt.nativeBaseAssets,49);assert.equal(receipt.nativeExtensionAssets,2);
  const known=JSON.parse(readFileSync(new URL('../readiness-73/INVENTORY.json',import.meta.url))).cleanup.envelope;
  assert.deepEqual(JSON.parse(readFileSync(join(original,'cleanup-expected.json'))),known);
  assert.equal(verifyPrepared(original,candidate).approval,'PENDING_ROOT_COHORT_AND_INDEPENDENT_HARNESS_REVIEW');
});
for(const invalid of ['HEAD','c355751f','0000000000000000000000000000000000000000'])test(`refuse candidate ${invalid}`,()=>assert.throws(()=>prepare(invalid,join(temporary,'invalid-'+invalid))));
test('existing capture cannot be overwritten',()=>assert.throws(()=>prepare(candidate,original),/EEXIST/));
const cases={
  'added entry':directory=>writeFileSync(join(directory,'extra'),'unexpected'),
  'removed entry':directory=>rmSync(join(directory,'public.mjs')),
  'changed entry':directory=>writeFileSync(join(directory,'public.mjs'),'changed'),
  'symlink entry':directory=>{rmSync(join(directory,'public.mjs'));symlinkSync(join(original,'public.mjs'),join(directory,'public.mjs'));},
  'missing cleanup input with rehashed receipt':directory=>rewrite(directory,'cleanup-expected.json',data=>{delete data.files['src/index.ts'];}),
  'wrong cleanup source bytes with rehashed receipt':directory=>rewrite(directory,'cleanup-expected.json',data=>{data.files['package.json']='0'.repeat(64);}),
  'missing policy input with rehashed receipt':directory=>rewrite(directory,'policy.json',data=>{data.scopeInputs.pop();}),
  'missing canonical path with rehashed receipt':directory=>rewrite(directory,'policy.json',data=>{data.canonicalFiles.pop();}),
  'native hash rebaseline with rehashed receipt':directory=>rewrite(directory,'policy.json',data=>{data.native.find(asset=>asset.name==='rg').sha256='5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7';}),
  'missing native extension with rehashed receipt':directory=>rewrite(directory,'policy.json',data=>{data.native.pop();}),
  'changed native extension with rehashed receipt':directory=>rewrite(directory,'policy.json',data=>{data.native.at(-1).sha256='0'.repeat(64);}),
  'false approval with rehashed receipt':directory=>rewrite(directory,'CANDIDATE.json',data=>{data.approval='ACCEPTED';}),
  'wrong source tree with rehashed receipt':directory=>rewrite(directory,'CANDIDATE.json',data=>{data.sourceTree='0'.repeat(40);}),
  'silent concurrency change':directory=>rewrite(directory,'policy.json',data=>{data.testConcurrency=6;}),
  'package metadata rebind':directory=>rewrite(directory,'CANDIDATE.json',data=>{data.package.name='other';}),
};
let index=0;
for(const [name,mutate]of Object.entries(cases))test(name,()=>{
  const directory=join(temporary,'mutation-'+index++);cpSync(original,directory,{recursive:true});mutate(directory);assert.throws(()=>verifyPrepared(directory,candidate));
});
test('wrong candidate argument never rebinds the receipt',()=>assert.throws(()=>verifyPrepared(original,'8670ebe8f0d39966c2de2638780437398e5f8490')));
test('symlink profile root refused',()=>{const link=join(temporary,'link');symlinkSync(original,link);assert.throws(()=>verifyPrepared(link,candidate));});
test('capture cannot write into live repo through a parent alias',()=>{
  const link=join(temporary,'repo-link');symlinkSync(fileURLToPath(new URL('../../../../',import.meta.url)),link);
  assert.throws(()=>prepare(candidate,join(link,'UNCREATED-profile73')),/outside the live repository/);
});
