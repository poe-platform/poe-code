import {types} from 'node:util';
import {Snapshot} from './frontmatter/config/snapshot.js';
const objectPrototype=Object.prototype,arrayPrototype=Array.prototype,arrayIterator=Array.prototype[Symbol.iterator],arrayMap=Array.prototype.map,arrayConstructor=Array;
const ownDescriptors=Object.getOwnPropertyDescriptors,prototype=Object.getPrototypeOf,ownSymbols=Object.getOwnPropertySymbols,own=Object.hasOwn,keys=Object.keys,entries=Object.entries,values=Object.values,define=Object.defineProperty;
const species=Object.getOwnPropertyDescriptor(Array,Symbol.species)?.get;
const ownDescriptor=Object.getOwnPropertyDescriptor;
export function mergeSnapshot(layers){
 if(Object.getOwnPropertyDescriptors!==ownDescriptors||Object.getOwnPropertyDescriptor!==ownDescriptor||Object.getPrototypeOf!==prototype||Object.getOwnPropertySymbols!==ownSymbols||Object.hasOwn!==own||Object.keys!==keys||Object.entries!==entries||Object.values!==values||Object.defineProperty!==define||Array!==arrayConstructor||ownDescriptor(arrayPrototype,'map')?.value!==arrayMap||ownDescriptor(arrayPrototype,Symbol.iterator)?.value!==arrayIterator||ownDescriptor(arrayPrototype,'constructor')?.value!==arrayConstructor||ownDescriptor(Array,Symbol.species)?.get!==species)return null;
 if(types.isProxy(layers)||!Array.isArray(layers)||prototype(layers)!==arrayPrototype||ownSymbols(layers).length)return null;
 const descriptors=ownDescriptors(layers),rows=[];
 for(let index=0;index<descriptors.length.value;index++){
  const item=descriptors[String(index)];if(!item||!own(item,'value'))return null;
  const layer=item.value;if(!layer||typeof layer!=='object'||types.isProxy(layer)||![null,objectPrototype].includes(prototype(layer)))return null;
  const row=ownDescriptors(layer),source=row.source,data=row.data;
  if(!source||!data||!own(source,'value')||!own(data,'value')||typeof source.value!=='string')return null;
  const root=data.value;if(!root||typeof root!=='object'||types.isProxy(root)||![null,objectPrototype].includes(prototype(root)))return null;
  rows.push([source.value,root]);
 }
 const output=new Snapshot(),references=[],active=new Set();let count=0;
 output.tag(9);output.count(rows.length);
 const tasks=[];for(let index=rows.length-1;index>=0;index--)tasks.push({kind:'row',source:rows[index][0],value:rows[index][1]});
 while(tasks.length){
  const task=tasks.pop();
  if(task.kind==='row'){output.tag(10);output.count(2);output.text('source');output.tag(5);output.text(task.source);output.text('data');tasks.push({kind:'visit',value:task.value,depth:0,array:false});continue;}
  if(task.kind==='leave'){active.delete(task.value);continue;}
  if(task.kind==='key'){output.text(task.key);continue;}
  const {value,depth,array:inArray}=task,type=typeof value;
  if(++count>100000||depth>256)return null;
  if(value===null){output.tag(0);continue;}
  if(type==='undefined'){output.tag(1);continue;}
  if(type==='boolean'){output.tag(value?3:2);continue;}
  if(type==='number'){output.tag(4);output.number(value);continue;}
  if(type==='string'){output.tag(5);output.text(value);continue;}
  let parent,array=false;
  if(type==='object'){
   if(types.isProxy(value))return null;
   array=Array.isArray(value);parent=prototype(value);
  }
  if(type!=='object'||!array&&parent!==null&&parent!==objectPrototype){output.tag(8);output.text(String(references.length));references.push(value);continue;}
  if(array&&parent!==arrayPrototype||inArray&&parent===null)return null;
  if(active.has(value))throw new Error('Cyclic config data is not supported.');
  active.add(value);const descriptors=ownDescriptors(value);
  tasks.push({kind:'leave',value});
  if(array){
   if(ownSymbols(value).length)return null;
   const length=descriptors.length.value,names=keys(descriptors);if(names.length!==length+1)return null;
   output.tag(9);output.count(length);
   for(let index=length-1;index>=0;index--){const descriptor=descriptors[String(index)];if(!descriptor||!own(descriptor,'value'))return null;tasks.push({kind:'visit',value:descriptor.value,depth:depth+1,array:true});}
  }else{
   const fields=entries(descriptors);for(const[,descriptor]of fields)if(!descriptor.enumerable||!own(descriptor,'value'))return null;
   output.tag(10);output.count(fields.length);
   for(let index=fields.length-1;index>=0;index--){const[key,descriptor]=fields[index];tasks.push({kind:'visit',value:descriptor.value,depth:depth+1,array:inArray},{kind:'key',key});}
  }
 }
 return {buffer:output.finish(),references};
}
