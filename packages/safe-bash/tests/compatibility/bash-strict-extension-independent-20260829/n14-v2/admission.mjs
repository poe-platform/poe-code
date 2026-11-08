import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const treeHash=body=>createHash('sha1').update('tree '+body.length+'\0').update(body).digest('hex');
export function admitSource(source,additional){
 assert.equal(source.computedTree,'bf079ada185a79aec864b068f3738ddc5520822e');assert.equal(source.inputs.length,293);
 const trees=new Map();
 for(const row of [...source.ancestorTrees,...source.fetchedTrees,...source.reconstructedTrees,...additional.fetched]){const body=Buffer.from(row.base64,'base64');assert.equal(treeHash(body),row.oid);if(trees.has(row.oid))assert.ok(trees.get(row.oid).equals(body));trees.set(row.oid,body);}
 const read=oid=>{const body=trees.get(oid);assert.ok(body,'missing bound subtree '+oid);const entries=[];const names=new Set();for(let offset=0;offset<body.length;){const space=body.indexOf(32,offset),nul=body.indexOf(0,space);assert.ok(space>offset&&nul>space&&nul+21<=body.length);const bytes=body.subarray(space+1,nul),name=bytes.toString();assert.ok(Buffer.from(name).equals(bytes));assert.ok(!names.has(name));names.add(name);entries.push({name,mode:body.subarray(offset,space).toString(),oid:body.subarray(nul+1,nul+21).toString('hex')});offset=nul+21;}const sorted=[...entries].sort((left,right)=>Buffer.compare(Buffer.from(left.name+(left.mode==='40000'?'/':'')),Buffer.from(right.name+(right.mode==='40000'?'/':''))));assert.deepEqual(entries,sorted);return entries;};
 const seen=new Set();for(const row of source.inputs){assert.ok(!seen.has(row.path));seen.add(row.path);assert.ok(!row.path.startsWith('/')&&!row.path.split('/').some(part=>part==='..'||part==='.'||part==='AGENTS.md'||part===''));assert.ok(!row.path.startsWith('src/commands/node/'));assert.ok(['100644','100755'].includes(row.mode));let oid=source.computedTree,entry;const parts=row.path.split('/');for(let index=0;index<parts.length;index++){entry=read(oid).find(item=>item.name===parts[index]);assert.ok(entry,'path absent '+row.path);if(index<parts.length-1){assert.equal(entry.mode,'40000');oid=entry.oid;}}assert.equal(entry.oid,row.blob);assert.equal(parseInt(entry.mode,8),parseInt(row.mode,8));}
 return{inputs:seen.size,trees:trees.size};
}
