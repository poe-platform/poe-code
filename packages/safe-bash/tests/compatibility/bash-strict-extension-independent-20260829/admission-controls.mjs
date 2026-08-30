import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {admitSource} from './admission.mjs';
const source=JSON.parse(await fs.readFile(new URL('./SOURCE.json',import.meta.url))),extra=JSON.parse(await fs.readFile(new URL('./SOURCE-TREES.json',import.meta.url)));
const rows=[];assert.deepEqual(admitSource(source,extra),{inputs:293,trees:125});rows.push({id:'authentic-derived-source',pass:true});
for(const[id,change]of [['path',copy=>copy.inputs[0].path+='-changed'],['mode',copy=>copy.inputs[0].mode='100755'],['blob',copy=>copy.inputs[0].blob='0'.repeat(40)],['missing',copy=>copy.inputs.pop()],['extra',copy=>copy.inputs.push(copy.inputs[0])],['duplicate',copy=>copy.inputs[1]=copy.inputs[0]],['derived-root',copy=>copy.computedTree='0'.repeat(40)]]){const copy=structuredClone(source);change(copy);assert.throws(()=>admitSource(copy,extra));rows.push({id,pass:true});}
console.log(JSON.stringify({role:'SOURCE_DATA_ONLY_NOT_PRODUCT',rows,pass:rows.length,fail:0}));
