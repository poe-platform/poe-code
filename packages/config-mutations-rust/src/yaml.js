import {createRequire} from 'node:module';
import {Snapshot} from './snapshot.js';
import {setConfigEntry,merge,prune} from './object.js';
const native=createRequire(import.meta.url)('./config-mutations-rust.node');
function graphSnapshot(root){
 const nodes=[],sources=new WeakMap();let anchor=0;
 function allocate(){const id=nodes.length;nodes.push({anchor:null});return id;}
 const rootId=allocate(),tasks=[{kind:'visit',value:root,id:rootId,depth:0}];
 try{while(tasks.length){
  const task=tasks.pop();
  if(task.kind==='next'){
   const item=task.iterator.next();if(item.done)continue;
   tasks.push(task);
   if(task.mapping){
    const [key,value]=item.value;if(value===undefined)continue;
    const keyId=allocate(),valueId=allocate();nodes[task.id].items.push([keyId,valueId]);
    tasks.push({kind:'visit',value,id:valueId,depth:task.depth+1},{kind:'visit',value:key,id:keyId,depth:task.depth+1});
   }else{const id=allocate();nodes[task.id].items.push(id);tasks.push({kind:'visit',value:item.value,id,depth:task.depth+1});}
   continue;
  }
  let {value,id,depth}=task;
  if(value instanceof String||value instanceof Number||value instanceof Boolean||value instanceof BigInt)value=value.valueOf();
  if(value&&typeof value==='object'){
   const target=sources.get(value);
   if(target!==undefined){nodes[target].anchor??=`a${++anchor}`;nodes[id].tag=11;nodes[id].target=target;continue;}
   sources.set(value,id);
  }
  // Core schema recognizes primitives only; host objects get one no-argument
  // toJSON call before their collection type is chosen.
  if(value!==null && (typeof value==='object'||typeof value==='function') && typeof value.toJSON==='function')value=value.toJSON();
  if(value&&typeof value==='object'){
   if(depth>=512)throw new Error('Maximum configuration depth exceeded');
   const mapping=value instanceof Map||!(Symbol.iterator in Object(value));
   let iterator;
   if(value instanceof Map)iterator=value[Symbol.iterator]();
   else if(!mapping)iterator=value[Symbol.iterator]();
   else iterator=(function*(){for(const key of Object.keys(value))yield [key,value[key]];})();
   nodes[id].tag=mapping?10:9;nodes[id].items=[];
   tasks.push({kind:'next',id,iterator,mapping,depth});
  }else{nodes[id].value=value;nodes[id].tag=value===null?0:typeof value==='undefined'?1:typeof value==='boolean'?value?3:2:typeof value==='number'?4:typeof value==='string'?5:typeof value==='bigint'?6:8;}
 }
 }catch(error){
  for(let i=tasks.length-1;i>=0;i--){const task=tasks[i];if(task.kind!=='next')continue;
   try{if(typeof task.iterator.return==='function')task.iterator.return();}catch{}
  }
  throw error;
 }
 const output=new Snapshot();output.count(rootId);output.count(nodes.length);
 for(const node of nodes){
  output.tag(node.anchor===null?0:1);if(node.anchor!==null)output.text(node.anchor);
  output.tag(node.tag);
  if(node.tag===4)output.number(node.value);
  else if(node.tag===5)output.text(node.value);
  else if(node.tag===6||node.tag===8)output.text(String(node.value));
  else if(node.tag===9){output.count(node.items.length);for(const id of node.items)output.count(id);}
  else if(node.tag===10){output.count(node.items.length);for(const[key,value]of node.items){output.count(key);output.count(value);}}
  else if(node.tag===11)output.count(node.target);
 }
 return output.finish();
}
export const yamlFormat={
 parse(content){
  const result=native.configYamlParse(content,epoch=>new Date(epoch).toString());
  if(result.error){const error=new Error(result.error.message);error.line=result.error.line;error.column=result.error.column;throw error;}
  const dates=new Map(),symbols=new Map();let dateIndex=0,symbolIndex=0;
  for(let i=0;i<result.temporals.length;i++){
   const[path,epoch,description]=result.temporals[i];let value;
   if(epoch==='symbol'){const id=result.symbolIds[symbolIndex++];if(!symbols.has(id))symbols.set(id,Symbol(description));value=symbols.get(id);}
   else{const id=result.dateIds[dateIndex++];if(!dates.has(id))dates.set(id,new Date(epoch));value=dates.get(id);}
   let parent=result.value;for(let j=0;j<path.length-1;j++)parent=parent[path[j]];setConfigEntry(parent,path.at(-1),value);
  }
  return result.value;
 },
 serialize(value){if(value===undefined)throw new TypeError("Cannot read properties of undefined (reading 'endsWith')");return native.configYamlSerialize(graphSnapshot(value));},
 merge,prune,
};
