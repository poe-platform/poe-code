import {test} from 'node:test';
import assert from 'node:assert/strict';
import {native} from '../dist/native.js';
import {createRequire} from 'node:module';
test('frontmatter snapshot re-evaluates repeated objects without generating aliases',async()=>{
 const {graphSnapshot}=await import('../dist/yaml-snapshot.js');
 const oracle=createRequire(import.meta.url)('yaml');let calls=0;
 const shared={toJSON(){calls++;return {value:'example'};}},data={a:shared,b:shared};
 const expected=oracle.stringify(data,{aliasDuplicateObjects:false});assert.equal(calls,2);calls=0;
 assert.equal(native.configYamlSerialize(graphSnapshot(data,false)),expected);assert.equal(calls,2);
 const object={nested:'shared'};
 assert.equal(native.configYamlSerialize(graphSnapshot({a:object,b:object},false)),oracle.stringify({a:object,b:object},{aliasDuplicateObjects:false}));
});
