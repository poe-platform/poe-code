import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalBytes,physicalCensus,expectedFromOld } from './census.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function run(seal) {
  const input=JSON.parse(readFileSync(new URL('./CANONICAL.json',import.meta.url))), results=[];
  const rows=input.example, expected=Buffer.from(input.exampleCanonicalHex,'hex');
  const check=(id,fn)=>{fn();results.push({id,pass:true});};
  const changed=mutate=>{const value=structuredClone(rows);mutate(value);assert.notEqual(hash(canonicalBytes(value)),hash(expected));};
  check('D01',()=>{assert.ok(input.componentOrderDiffers);assert.ok(canonicalBytes(rows).equals(expected));});
  check('D02',()=>assert.ok(canonicalBytes([...rows].reverse()).equals(expected)));
  check('D03',()=>changed(value=>{value[0].path+='.changed';}));
  check('D04',()=>changed(value=>{value[0].mode^=1;}));
  check('D05',()=>changed(value=>{value[1].sha256='f'.repeat(64);}));
  check('D06',()=>changed(value=>{value.pop();}));
  check('D07',()=>changed(value=>{value.push({...value[1],path:'/extra'});}));
  check('D08',()=>assert.throws(()=>canonicalBytes([...rows,rows[0]])));
  check('D09',()=>{const value=[...rows];delete value[0];assert.throws(()=>canonicalBytes(value));});
  check('D10',()=>{const value=structuredClone(rows);Object.defineProperty(value[0],'path',{get(){throw Error('must not invoke accessor');}});assert.throws(()=>canonicalBytes(value));});
  check('D11',()=>{const value=structuredClone(rows);value[0].path='\ud800';assert.throws(()=>canonicalBytes(value));});
  check('D12',()=>{const value=structuredClone(rows);value[0].extra=1;assert.throws(()=>canonicalBytes(value));});
  check('D13',()=>changed(value=>{value[3].link+='other';}));
  check('D14',()=>{
    for(const binding of input.bindings) {
      const bytes=readFileSync(binding.sourcePath);assert.equal(hash(bytes),binding.sourceSha256);
      let rows=JSON.parse(bytes);for(const key of binding.selector)rows=rows[key];
      const expectedRows=expectedFromOld(rows,binding.modeWitness);
      assert.equal(hash(canonicalBytes(expectedRows)),binding.canonicalSha256,'independent producer expected digest');
      const actual=physicalCensus(binding.root);
      assert.equal(hash(canonicalBytes(actual)),binding.canonicalSha256,'independent physical read');
      const strip=rows=>rows.map(row=>{const copy={...row};delete copy.mode;return copy;}).sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
      assert.deepEqual(strip(actual),strip(expectedRows),'independent old membership/value comparison');
    }
  });
  return results;
}
